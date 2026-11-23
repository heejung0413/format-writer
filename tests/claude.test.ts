import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { streamClaude } from "@/lib/claude";
import type { StreamLine } from "@/lib/types";

const streamMock = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", async () => {
  const actual = await vi.importActual<typeof import("@anthropic-ai/sdk")>("@anthropic-ai/sdk");
  // 실제 클래스를 상속해 Anthropic.APIError 등 정적 오류 클래스를 그대로 쓴다.
  class FakeAnthropic extends actual.default {
    constructor() {
      super({ apiKey: "test-key" });
      Object.defineProperty(this, "beta", {
        value: { messages: { stream: streamMock } },
      });
    }
  }
  return { ...actual, default: FakeAnthropic };
});

type FakeEvent = { type: string; delta?: { type: string; text?: string } };

const textDelta = (text: string): FakeEvent => ({
  type: "content_block_delta",
  delta: { type: "text_delta", text },
});

function fakeStream(args: {
  events?: FakeEvent[];
  stopReason?: string;
  throwError?: unknown;
}) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of args.events ?? []) yield event;
      if (args.throwError) throw args.throwError;
    },
    finalMessage: async () => ({ stop_reason: args.stopReason ?? "end_turn" }),
  };
}

async function run(signal?: AbortSignal): Promise<StreamLine[]> {
  const out: StreamLine[] = [];
  for await (const line of streamClaude({
    system: "시스템",
    messages: [{ role: "user", content: "내용" }],
    signal,
  })) {
    out.push(line);
  }
  return out;
}

const savedModel = process.env.CLAUDE_MODEL;

beforeEach(() => {
  streamMock.mockReset();
  delete process.env.CLAUDE_MODEL;
});

afterEach(() => {
  if (savedModel === undefined) delete process.env.CLAUDE_MODEL;
  else process.env.CLAUDE_MODEL = savedModel;
});

describe("streamClaude", () => {
  test("텍스트 조각은 text 줄이 되고 다른 이벤트는 무시한다", async () => {
    streamMock.mockReturnValue(
      fakeStream({
        events: [
          { type: "message_start" },
          textDelta("안녕"),
          { type: "content_block_delta", delta: { type: "input_json_delta" } },
          textDelta("하세요"),
        ],
      }),
    );
    expect(await run()).toEqual([
      { type: "text", text: "안녕" },
      { type: "text", text: "하세요" },
      { type: "done" },
    ]);
  });

  test("정상 종료하면 done으로 끝난다", async () => {
    streamMock.mockReturnValue(fakeStream({ events: [textDelta("글")], stopReason: "end_turn" }));
    const lines = await run();
    expect(lines.at(-1)).toEqual({ type: "done" });
  });

  test("refusal이면 거절 error 줄만 내고 done은 없다", async () => {
    streamMock.mockReturnValue(fakeStream({ events: [textDelta("글")], stopReason: "refusal" }));
    const lines = await run();
    expect(lines.at(-1)).toEqual({
      type: "error",
      code: "refusal",
      message: "이 내용은 작성할 수 없습니다.",
    });
    expect(lines.some((l) => l.type === "done")).toBe(false);
  });

  test("SDK 오류는 변환한 error 줄이 된다", async () => {
    const err = Anthropic.APIError.generate(429, undefined, "rate limited", new Headers());
    streamMock.mockReturnValue(fakeStream({ throwError: err }));
    expect(await run()).toEqual([
      { type: "error", code: "rate_limit", message: "요청이 많습니다. 잠시 후 다시 시도해 주세요." },
    ]);
  });

  test("이미 중단된 signal이면 오류가 나도 아무것도 내지 않는다", async () => {
    streamMock.mockReturnValue(fakeStream({ throwError: new Error("aborted") }));
    const controller = new AbortController();
    controller.abort();
    expect(await run(controller.signal)).toEqual([]);
  });

  test("기본 모델과 요청 옵션을 SDK에 넘긴다", async () => {
    streamMock.mockReturnValue(fakeStream({ events: [textDelta("글")] }));
    const controller = new AbortController();
    await run(controller.signal);
    const [params, options] = streamMock.mock.calls[0];
    expect(params).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: "시스템",
      messages: [{ role: "user", content: "내용" }],
    });
    expect(options.signal).toBe(controller.signal);
  });

  test("CLAUDE_MODEL이 있으면 그 모델을 쓴다", async () => {
    process.env.CLAUDE_MODEL = "claude-test-model";
    streamMock.mockReturnValue(fakeStream({ events: [textDelta("글")] }));
    await run();
    expect(streamMock.mock.calls[0][0].model).toBe("claude-test-model");
  });

  const INCOMPLETE: StreamLine = {
    type: "error",
    code: "api_error",
    message: "글이 끝까지 작성되지 않았습니다. 다시 시도해 주세요.",
  };

  test("max_tokens로 끝나면 done 대신 미완성 오류를 낸다", async () => {
    streamMock.mockReturnValue(fakeStream({ events: [textDelta("글")], stopReason: "max_tokens" }));
    const lines = await run();
    expect(lines.at(-1)).toEqual(INCOMPLETE);
    expect(lines.some((l) => l.type === "done")).toBe(false);
  });

  test("글자가 하나도 없이 끝나면 미완성 오류를 낸다", async () => {
    streamMock.mockReturnValue(fakeStream({ events: [] }));
    expect(await run()).toEqual([INCOMPLETE]);
  });

  test("공백만 나오고 끝나도 미완성 오류를 낸다", async () => {
    streamMock.mockReturnValue(fakeStream({ events: [textDelta("  "), textDelta("\n")] }));
    const lines = await run();
    expect(lines.at(-1)).toEqual(INCOMPLETE);
    expect(lines.some((l) => l.type === "done")).toBe(false);
  });
});
