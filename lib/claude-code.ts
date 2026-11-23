import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import type { ChatMessage, StreamLine } from "./types";

const DEFAULT_MODEL = "claude-opus-5-5";
const INCOMPLETE = "글이 끝까지 작성되지 않았습니다. 다시 시도해 주세요.";

type ChildEnv = Record<string, string | undefined>;

export type SpawnFn = (
  command: string,
  args: string[],
  options: { cwd: string; env: ChildEnv },
) => ChildProcessWithoutNullStreams;

type ResultEvent = { is_error?: boolean; result?: unknown; stop_reason?: unknown };

export function buildPrompt(messages: ChatMessage[]): string {
  if (messages.length === 1) return messages[0].content;
  const [first, ...rest] = messages;
  const parts = [`<원문>\n${first.content}\n</원문>`];
  for (const message of rest) {
    const tag = message.role === "assistant" ? "작성한 글" : "수정 지시";
    parts.push(`<${tag}>\n${message.content}\n</${tag}>`);
  }
  parts.push("마지막 수정 지시를 반영해 가장 최근에 작성한 글을 고쳐 전체를 다시 출력한다.");
  return parts.join("\n\n");
}

function childEnv(): ChildEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        key === "CLAUDE_CONFIG_DIR" || !(key.startsWith("ANTHROPIC_") || key.startsWith("CLAUDE")),
    ),
  );
}

function textDelta(event: unknown): string | null {
  const data = event as {
    type?: unknown;
    event?: { type?: unknown; delta?: { type?: unknown; text?: unknown } };
  };
  if (data?.type !== "stream_event" || data.event?.type !== "content_block_delta") return null;
  const delta = data.event.delta;
  return delta?.type === "text_delta" && typeof delta.text === "string" ? delta.text : null;
}

export async function* streamClaudeCode(
  args: { system: string; messages: ChatMessage[]; signal?: AbortSignal },
  spawnFn: SpawnFn = (command, args, options) =>
    spawn(command, args, { cwd: options.cwd, env: options.env as NodeJS.ProcessEnv }),
): AsyncGenerator<StreamLine> {
  const { system, messages, signal } = args;
  if (signal?.aborted) return;

  const child = spawnFn(
    "claude",
    [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--setting-sources",
      "",
      "--strict-mcp-config",
      "--tools",
      "",
      "--disable-slash-commands",
      "--no-session-persistence",
      "--model",
      process.env.CLAUDE_MODEL || DEFAULT_MODEL,
      "--effort",
      "low",
      "--system-prompt",
      system,
    ],
    { cwd: tmpdir(), env: childEnv() },
  );

  let spawnError: NodeJS.ErrnoException | null = null;
  let stderr = "";
  const closed = new Promise<number | null>((resolve) => {
    child.on("close", (code) => resolve(code));
    child.on("error", (err) => {
      spawnError = err;
      resolve(null);
    });
  });
  const onAbort = () => child.kill();
  signal?.addEventListener("abort", onAbort, { once: true });
  child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
  child.stdin.on("error", () => {});
  child.stdin.end(buildPrompt(messages));

  let text = "";
  let result: ResultEvent | null = null;
  try {
    for await (const raw of createInterface({ input: child.stdout })) {
      let event: unknown;
      try {
        event = JSON.parse(raw);
      } catch {
        continue;
      }
      const delta = textDelta(event);
      if (delta !== null) {
        text += delta;
        yield { type: "text", text: delta };
      } else if ((event as { type?: unknown })?.type === "result") {
        result = event as ResultEvent;
      }
    }
    const code = await closed;
    if (signal?.aborted) return;

    const failure = spawnError as NodeJS.ErrnoException | null;
    if (failure) {
      yield {
        type: "error",
        code: "auth",
        message:
          failure.code === "ENOENT"
            ? "Claude Code를 찾을 수 없습니다. 터미널에서 claude 명령이 실행되는지 확인해 주세요."
            : `Claude Code를 실행하지 못했습니다: ${failure.message}`,
      };
      return;
    }
    const finished = result as ResultEvent | null;
    if (!finished || finished.is_error || code !== 0) {
      const reason =
        (typeof finished?.result === "string" && finished.result.trim()) ||
        stderr.trim().slice(0, 300) ||
        "원인을 알 수 없습니다.";
      yield {
        type: "error",
        code: "api_error",
        message: `Claude Code 요청에 실패했습니다: ${reason}`,
      };
      return;
    }
    if (finished.stop_reason === "refusal") {
      yield { type: "error", code: "refusal", message: "이 내용은 작성할 수 없습니다." };
      return;
    }
    if (finished.stop_reason === "max_tokens" || !text.trim()) {
      yield { type: "error", code: "api_error", message: INCOMPLETE };
      return;
    }
    yield { type: "done" };
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (child.exitCode === null) child.kill();
  }
}
