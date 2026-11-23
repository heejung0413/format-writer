import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildPrompt, streamClaudeCode, type SpawnFn } from "@/lib/claude-code";
import type { StreamLine } from "@/lib/types";

type Call = { command: string; args: string[]; options: { cwd?: string; env?: Record<string, string | undefined> } };

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  killed = false;
  written = "";

  constructor() {
    super();
    this.stdin.on("data", (chunk) => (this.written += chunk.toString()));
  }

  kill() {
    this.killed = true;
    this.finish(null);
    return true;
  }

  finish(code: number | null) {
    if (this.exitCode !== null || this.stdout.writableEnded) return;
    this.exitCode = code ?? 143;
    this.stdout.end();
    this.stderr.end();
    setImmediate(() => this.emit("close", code));
  }
}

function fakeSpawn(script: (child: FakeChild) => void) {
  const calls: Call[] = [];
  const children: FakeChild[] = [];
  const spawnFn = ((command: string, args: string[], options: Call["options"]) => {
    calls.push({ command, args, options });
    const child = new FakeChild();
    children.push(child);
    setImmediate(() => script(child));
    return child;
  }) as unknown as SpawnFn;
  return { spawnFn, calls, children };
}

const delta = (text: string) =>
  JSON.stringify({
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "text_delta", text } },
  }) + "\n";

const result = (fields: Record<string, unknown>) =>
  JSON.stringify({ type: "result", subtype: "success", is_error: false, stop_reason: "end_turn", ...fields }) + "\n";

async function collect(gen: AsyncGenerator<StreamLine>): Promise<StreamLine[]> {
  const out: StreamLine[] = [];
  for await (const line of gen) out.push(line);
  return out;
}

const input = { system: "지시문", messages: [{ role: "user" as const, content: "내용" }] };

const saved = { key: process.env.ANTHROPIC_API_KEY, model: process.env.CLAUDE_MODEL };

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "sk-test";
  delete process.env.CLAUDE_MODEL;
});

afterEach(() => {
  if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = saved.key;
  if (saved.model === undefined) delete process.env.CLAUDE_MODEL;
  else process.env.CLAUDE_MODEL = saved.model;
});

describe("buildPrompt", () => {
  test("메시지가 하나면 그 내용 그대로다", () => {
    expect(buildPrompt([{ role: "user", content: "내용" }])).toBe("내용");
  });

  test("다듬기 대화는 원문·작성한 글·수정 지시를 순서대로 담는다", () => {
    const prompt = buildPrompt([
      { role: "user", content: "원래 내용" },
      { role: "assistant", content: "첫 결과" },
      { role: "user", content: "더 짧게" },
    ]);
    const order = ["<원문>", "원래 내용", "<작성한 글>", "첫 결과", "<수정 지시>", "더 짧게"].map((s) =>
      prompt.indexOf(s),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe("streamClaudeCode", () => {
  test("글 조각을 text 줄로 내고 정상 종료면 done", async () => {
    const { spawnFn } = fakeSpawn((child) => {
      child.stdout.write(JSON.stringify({ type: "system", subtype: "init" }) + "\n");
      child.stdout.write(delta("안녕") + delta("하세요"));
      child.stdout.write("JSON 아님\n");
      child.stdout.write(result({}));
      child.finish(0);
    });
    expect(await collect(streamClaudeCode(input, spawnFn))).toEqual([
      { type: "text", text: "안녕" },
      { type: "text", text: "하세요" },
      { type: "done" },
    ]);
  });

  test("도구·설정·MCP 없이 지시문과 모델을 넘기고 내용은 stdin으로 보낸다", async () => {
    const { spawnFn, calls, children } = fakeSpawn((child) => {
      child.stdout.write(delta("가") + result({}));
      child.finish(0);
    });
    await collect(streamClaudeCode(input, spawnFn));
    const { command, args, options } = calls[0];
    expect(command).toBe("claude");
    const valueOf = (flag: string) => args[args.indexOf(flag) + 1];
    expect(args).toContain("-p");
    expect(valueOf("--output-format")).toBe("stream-json");
    expect(args).toContain("--include-partial-messages");
    expect(valueOf("--tools")).toBe("");
    expect(valueOf("--setting-sources")).toBe("");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--no-session-persistence");
    expect(valueOf("--system-prompt")).toBe("지시문");
    expect(valueOf("--model")).toBe("claude-opus-5-5");
    expect(valueOf("--effort")).toBe("low");
    expect(args).not.toContain("내용");
    expect(children[0].written).toBe("내용");
    expect(options.cwd).toBe(tmpdir());
  });

  test("CLAUDE_MODEL이 있으면 그 모델을 쓴다", async () => {
    process.env.CLAUDE_MODEL = "claude-haiku-5-5";
    const { spawnFn, calls } = fakeSpawn((child) => {
      child.stdout.write(delta("가") + result({}));
      child.finish(0);
    });
    await collect(streamClaudeCode(input, spawnFn));
    const args = calls[0].args;
    expect(args[args.indexOf("--model") + 1]).toBe("claude-haiku-5-5");
  });

  test("API 키를 자식 프로세스에 넘기지 않는다", async () => {
    const { spawnFn, calls } = fakeSpawn((child) => {
      child.stdout.write(delta("가") + result({}));
      child.finish(0);
    });
    await collect(streamClaudeCode(input, spawnFn));
    const env = calls[0].options.env ?? {};
    expect(Object.keys(env).filter((k) => k.startsWith("ANTHROPIC_"))).toEqual([]);
    expect(env.PATH).toBe(process.env.PATH);
  });

  test("Claude Code가 오류로 끝나면 사유를 담은 api_error", async () => {
    const { spawnFn } = fakeSpawn((child) => {
      child.stdout.write(result({ is_error: true, result: "Not logged in · Please run /login" }));
      child.finish(1);
    });
    const lines = await collect(streamClaudeCode(input, spawnFn));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: "error", code: "api_error" });
    expect((lines[0] as { message: string }).message).toContain("Not logged in");
  });

  test("결과 없이 죽으면 stderr를 사유로 보여 준다", async () => {
    const { spawnFn } = fakeSpawn((child) => {
      child.stderr.write("something broke");
      child.finish(2);
    });
    const lines = await collect(streamClaudeCode(input, spawnFn));
    expect(lines[0]).toMatchObject({ type: "error", code: "api_error" });
    expect((lines[0] as { message: string }).message).toContain("something broke");
  });

  test("claude 명령이 없으면 auth 오류로 설치·로그인을 안내한다", async () => {
    const { spawnFn } = fakeSpawn((child) => {
      child.emit("error", Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }));
      child.finish(null);
    });
    const lines = await collect(streamClaudeCode(input, spawnFn));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: "error", code: "auth" });
    expect((lines[0] as { message: string }).message).toContain("Claude Code");
  });

  test("거절이면 refusal 오류", async () => {
    const { spawnFn } = fakeSpawn((child) => {
      child.stdout.write(result({ stop_reason: "refusal" }));
      child.finish(0);
    });
    expect(await collect(streamClaudeCode(input, spawnFn))).toEqual([
      { type: "error", code: "refusal", message: "이 내용은 작성할 수 없습니다." },
    ]);
  });

  test("글이 비었거나 max_tokens로 끊기면 done 대신 오류", async () => {
    const empty = fakeSpawn((child) => {
      child.stdout.write(delta("  ") + result({}));
      child.finish(0);
    });
    const cut = fakeSpawn((child) => {
      child.stdout.write(delta("쓰다가") + result({ stop_reason: "max_tokens" }));
      child.finish(0);
    });
    for (const { spawnFn } of [empty, cut]) {
      const lines = await collect(streamClaudeCode(input, spawnFn));
      expect(lines.at(-1)).toMatchObject({ type: "error", code: "api_error" });
      expect(lines.some((l) => l.type === "done")).toBe(false);
    }
  });

  test("중단하면 프로세스를 끝내고 done도 error도 내지 않는다", async () => {
    const controller = new AbortController();
    const { spawnFn, children } = fakeSpawn((child) => {
      child.stdout.write(delta("쓰는 중"));
    });
    const lines: StreamLine[] = [];
    for await (const line of streamClaudeCode({ ...input, signal: controller.signal }, spawnFn)) {
      lines.push(line);
      controller.abort();
    }
    expect(lines).toEqual([{ type: "text", text: "쓰는 중" }]);
    expect(children[0].killed).toBe(true);
  });

  test("이미 중단된 신호면 프로세스를 띄우지 않는다", async () => {
    const controller = new AbortController();
    controller.abort();
    const { spawnFn, calls } = fakeSpawn(() => {});
    expect(await collect(streamClaudeCode({ ...input, signal: controller.signal }, spawnFn))).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
