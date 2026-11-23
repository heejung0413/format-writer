import Anthropic from "@anthropic-ai/sdk";
import { toErrorLine } from "./errors";
import type { ChatMessage, StreamLine } from "./types";

const DEFAULT_MODEL = "claude-opus-5-5";

export async function* streamClaude(args: {
  system: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}): AsyncGenerator<StreamLine> {
  const { system, messages, signal } = args;
  try {
    const client = new Anthropic();
    const stream = client.beta.messages.stream(
      {
        model: process.env.CLAUDE_MODEL || DEFAULT_MODEL,
        max_tokens: 64000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low" },
        system,
        messages,
      },
      { signal },
    );

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "text", text: event.delta.text };
      }
    }

    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      yield { type: "error", code: "refusal", message: "이 내용은 작성할 수 없습니다." };
      return;
    }
    yield { type: "done" };
  } catch (err) {
    if (signal?.aborted) return;
    yield toErrorLine(err);
  }
}
