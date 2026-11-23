import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as formatItem from "@/app/api/formats/[id]/route";
import * as formats from "@/app/api/formats/route";
import * as historyItem from "@/app/api/history/[id]/route";
import * as history from "@/app/api/history/route";

vi.mock("next/server", () => ({ connection: async () => {} }));

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fw-routes-"));
  process.env.DATA_DIR = dir;
});

afterEach(async () => {
  delete process.env.DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

function request(method: string, body?: unknown) {
  return new Request("http://localhost/api/x", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("/api/formats", () => {
  test("GET은 기본 포맷 3개를 돌려준다", async () => {
    const list = await (await formats.GET()).json();
    expect(list.map((f: { id: string }) => f.id)).toEqual(["mail", "chat", "report"]);
  });

  test("POST는 앞뒤 공백을 지우고 추가한다", async () => {
    const res = await formats.POST(
      request("POST", { name: " 주간보고 ", instruction: " 표로 쓴다. ", example: "  " }),
    );
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.name).toBe("주간보고");
    expect(created.instruction).toBe("표로 쓴다.");
    expect(created.example).toBeUndefined();
  });

  test("POST에 이름이나 지시문이 없으면 400", async () => {
    expect((await formats.POST(request("POST", { name: "", instruction: "x" }))).status).toBe(400);
    expect((await formats.POST(request("POST", { name: "x" }))).status).toBe(400);
  });

  test("PUT은 수정하고, 없는 id는 404", async () => {
    const res = await formatItem.PUT(
      request("PUT", { name: "메신저", instruction: "짧게." }),
      ctx("chat"),
    );
    expect((await res.json()).name).toBe("메신저");
    const missing = await formatItem.PUT(
      request("PUT", { name: "a", instruction: "b" }),
      ctx("nope"),
    );
    expect(missing.status).toBe(404);
  });

  test("DELETE는 204, 없는 id는 404", async () => {
    expect((await formatItem.DELETE(request("DELETE"), ctx("report"))).status).toBe(204);
    expect((await formatItem.DELETE(request("DELETE"), ctx("report"))).status).toBe(404);
  });
});

describe("/api/history", () => {
  const entry = {
    formatId: "mail",
    formatName: "메일",
    recipient: "상사",
    tone: "격식",
    input: "내용",
    output: "결과",
  };

  test("POST로 추가한 기록이 GET에 나온다", async () => {
    const res = await history.POST(request("POST", entry));
    expect(res.status).toBe(201);
    const created = await res.json();
    const list = await (await history.GET()).json();
    expect(list).toEqual([created]);
  });

  test("POST에 문자열이 아닌 값이 있으면 400", async () => {
    const res = await history.POST(request("POST", { ...entry, output: 3 }));
    expect(res.status).toBe(400);
  });

  test("PATCH는 결과를 갱신하고, 없는 id는 404", async () => {
    const created = await (await history.POST(request("POST", entry))).json();
    const res = await historyItem.PATCH(request("PATCH", { output: "다듬음" }), ctx(created.id));
    expect((await res.json()).output).toBe("다듬음");
    const missing = await historyItem.PATCH(request("PATCH", { output: "x" }), ctx("nope"));
    expect(missing.status).toBe(404);
  });

  test("DELETE는 204, 없는 id는 404", async () => {
    const created = await (await history.POST(request("POST", entry))).json();
    expect((await historyItem.DELETE(request("DELETE"), ctx(created.id))).status).toBe(204);
    expect((await historyItem.DELETE(request("DELETE"), ctx(created.id))).status).toBe(404);
  });
});
