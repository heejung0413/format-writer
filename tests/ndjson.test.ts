import { describe, expect, test } from "vitest";
import { readStreamLines } from "@/lib/ndjson";
import type { StreamLine } from "@/lib/types";

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<StreamLine[]> {
  const out: StreamLine[] = [];
  for await (const line of readStreamLines(stream)) out.push(line);
  return out;
}

const encoder = new TextEncoder();

describe("readStreamLines", () => {
  test("한 덩어리에 든 여러 줄을 나눠 읽는다", async () => {
    const text = '{"type":"text","text":"가"}\n{"type":"done"}\n';
    expect(await collect(streamOf([encoder.encode(text)]))).toEqual([
      { type: "text", text: "가" },
      { type: "done" },
    ]);
  });

  test("줄 중간이나 한글 글자 중간에서 잘린 덩어리를 이어 붙인다", async () => {
    const bytes = encoder.encode('{"type":"text","text":"안녕하세요"}\n{"type":"done"}\n');
    const chunks = [bytes.slice(0, 25), bytes.slice(25, 26), bytes.slice(26)];
    expect(await collect(streamOf(chunks))).toEqual([
      { type: "text", text: "안녕하세요" },
      { type: "done" },
    ]);
  });

  test("끝에 줄바꿈이 없어도 마지막 줄을 읽는다", async () => {
    expect(await collect(streamOf([encoder.encode('{"type":"done"}')]))).toEqual([
      { type: "done" },
    ]);
  });

  test("빈 스트림이면 아무것도 내지 않는다", async () => {
    expect(await collect(streamOf([]))).toEqual([]);
  });
});
