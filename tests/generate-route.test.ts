import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ChatMessage, StreamLine } from "@/lib/types";

const calls: { system: string; messages: ChatMessage[]; signal?: AbortSignal }[] = [];
let lines: StreamLine[] = [];
let hold = false;

vi.mock("@/lib/claude", () => ({
  async *streamClaude(args: { system: string; messages: ChatMessage[]; signal?: AbortSignal }) {
    calls.push({ system: args.system, messages: args.messages, signal: args.signal });
    for (const line of lines) yield line;
    if (hold && args.signal) {
      const signal = args.signal;
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
    }
  },
}));

import { POST } from "@/app/api/generate/route";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fw-gen-"));
  process.env.DATA_DIR = dir;
  calls.length = 0;
  hold = false;
  lines = [{ type: "text", text: "안녕" }, { type: "text", text: "하세요" }, { type: "done" }];
});

afterEach(async () => {
  delete process.env.DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

function makeRequest(body: unknown, signal?: AbortSignal) {
  return new Request("http://localhost/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

function post(body: unknown) {
  return POST(makeRequest(body));
}

describe("POST /api/generate", () => {
  test("입력이 비어 있으면 400", async () => {
    const res = await post({ input: "   ", formatId: "mail" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_request");
    expect(calls).toHaveLength(0);
  });

  test("없는 포맷이면 404", async () => {
    const res = await post({ input: "내용", formatId: "nope" });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  test("한 줄에 JSON 하나씩 흘려보낸다", async () => {
    const res = await post({ input: "내용", formatId: "mail", recipient: "상사", tone: "격식" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/x-ndjson");
    const body = await res.text();
    expect(body.trim().split("\n").map((l) => JSON.parse(l))).toEqual(lines);
  });

  test("첫 생성은 입력을 user 메시지 하나로 보내고 지시문에 옵션을 담는다", async () => {
    await (await post({ input: " 내용 ", formatId: "mail", recipient: "상사", tone: "격식" })).text();
    expect(calls[0].messages).toEqual([{ role: "user", content: "내용" }]);
    expect(calls[0].system).toContain("포맷: 메일");
    expect(calls[0].system).toContain("받는 사람: 상사");
    expect(calls[0].system).toContain("말투: 격식");
  });

  test("목록에 없는 받는 사람·말투는 기본값으로 바꾼다", async () => {
    await (await post({ input: "내용", formatId: "mail", recipient: "외계인", tone: "랩" })).text();
    expect(calls[0].system).not.toContain("받는 사람:");
    expect(calls[0].system).toContain("말투: 보통");
  });

  test("다듬기는 받은 대화를 그대로 보내고 형식이 틀린 항목은 버린다", async () => {
    const messages = [
      { role: "user", content: "내용" },
      { role: "assistant", content: "결과" },
      { role: "system", content: "끼어든 것" },
      { role: "user", content: "더 짧게" },
    ];
    await (await post({ input: "내용", formatId: "mail", messages })).text();
    expect(calls[0].messages).toEqual([
      { role: "user", content: "내용" },
      { role: "assistant", content: "결과" },
      { role: "user", content: "더 짧게" },
    ]);
  });

  test("Claude 오류는 200 스트림 안의 error 줄로 전달한다", async () => {
    lines = [{ type: "error", code: "rate_limit", message: "요청이 많습니다." }];
    const res = await post({ input: "내용", formatId: "mail" });
    expect(res.status).toBe(200);
    expect(JSON.parse((await res.text()).trim())).toEqual(lines[0]);
  });

  test("JSON이 아닌 요청은 415이고 Claude를 부르지 않는다", async () => {
    const res = await POST(
      new Request("http://localhost/api/generate", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ input: "내용", formatId: "mail" }),
      }),
    );
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({
      error: { code: "unsupported_media_type", message: "JSON 요청만 받습니다." },
    });
    expect(calls).toHaveLength(0);
  });

  describe("중단 처리", () => {
    test("streamClaude에 중단 signal을 넘긴다", async () => {
      await (await post({ input: "내용", formatId: "mail" })).text();
      expect(calls[0].signal).toBeInstanceOf(AbortSignal);
      expect(calls[0].signal?.aborted).toBe(false);
    });

    test("응답 본문을 취소하면 signal이 중단된다", async () => {
      hold = true;
      const res = await post({ input: "내용", formatId: "mail" });
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0].signal?.aborted).toBe(false);
      await res.body!.cancel();
      expect(calls[0].signal?.aborted).toBe(true);
    });

    test("요청 자체가 중단되면 signal이 중단된다", async () => {
      hold = true;
      const client = new AbortController();
      const res = await POST(makeRequest({ input: "내용", formatId: "mail" }, client.signal));
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0].signal?.aborted).toBe(false);
      client.abort();
      expect(calls[0].signal?.aborted).toBe(true);
      await res.body!.cancel();
    });

    test("이미 중단된 요청이면 signal도 처음부터 중단 상태다", async () => {
      const client = new AbortController();
      client.abort();
      const res = await POST(makeRequest({ input: "내용", formatId: "mail" }, client.signal));
      await res.text().catch(() => "");
      expect(calls[0]?.signal?.aborted).toBe(true);
    });
  });
});
