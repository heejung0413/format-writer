import { streamClaude } from "@/lib/claude";
import { RECIPIENTS, TONES } from "@/lib/defaults";
import { buildSystemPrompt } from "@/lib/prompt";
import { listFormats } from "@/lib/store";
import type { ChatMessage } from "@/lib/types";

function fail(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

function pick(value: unknown, allowed: readonly string[], fallback: string): string {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}

function toMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (m): m is ChatMessage =>
      (m?.role === "user" || m?.role === "assistant") &&
      typeof m?.content === "string" &&
      m.content.trim() !== "",
  );
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const input = typeof body?.input === "string" ? body.input.trim() : "";
  if (!input) return fail(400, "bad_request", "내용을 입력해 주세요.");

  const format = (await listFormats()).find((f) => f.id === body.formatId);
  if (!format) return fail(404, "not_found", "포맷을 찾을 수 없습니다. 포맷을 다시 골라 주세요.");

  const system = buildSystemPrompt({
    format,
    recipient: pick(body.recipient, RECIPIENTS, "없음"),
    tone: pick(body.tone, TONES, "보통"),
  });
  const history = toMessages(body.messages);
  const messages: ChatMessage[] = history.length ? history : [{ role: "user", content: input }];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for await (const line of streamClaude({ system, messages, signal: req.signal })) {
        controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
