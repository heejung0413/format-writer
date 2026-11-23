import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as formatItem from "@/app/api/formats/[id]/route";
import * as formatDefaults from "@/app/api/formats/defaults/route";
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
  test("GET은 기본 포맷 7개를 돌려준다", async () => {
    const list = await (await formats.GET()).json();
    expect(list.map((f: { id: string }) => f.id)).toEqual([
      "mail",
      "chat",
      "report",
      "jira",
      "mr",
      "review",
      "weekly",
    ]);
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

describe("POST /api/formats/defaults", () => {
  test("지운 기본 포맷을 되살리고 목록과 추가한 개수를 돌려준다", async () => {
    await formatItem.DELETE(request("DELETE"), ctx("jira"));
    await formatItem.DELETE(request("DELETE"), ctx("chat"));
    const res = await formatDefaults.POST(request("POST"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.added).toBe(2);
    // 기본 포맷 순서(chat, jira)대로 끝에 붙는다.
    expect(body.formats.map((f: { id: string }) => f.id)).toEqual([
      "mail",
      "report",
      "mr",
      "review",
      "weekly",
      "chat",
      "jira",
    ]);
    expect(await (await formats.GET()).json()).toEqual(body.formats);
  });

  test("추가할 것이 없으면 added는 0이다", async () => {
    const body = await (await formatDefaults.POST(request("POST"))).json();
    expect(body.added).toBe(0);
    expect(body.formats).toHaveLength(7);
  });

  test("요청 본문 없이도 받는다", async () => {
    const res = await formatDefaults.POST(
      new Request("http://localhost/api/formats/defaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(200);
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

describe("JSON이 아닌 요청은 415", () => {
  const body = JSON.stringify({ name: "a", instruction: "b" });
  const plain = (method: string) =>
    new Request("http://localhost/api/x", {
      method,
      headers: { "Content-Type": "text/plain" },
      body,
    });
  const noType = (method: string) =>
    new Request("http://localhost/api/x", { method, body: new Blob([body]) });

  const expected = {
    error: { code: "unsupported_media_type", message: "JSON 요청만 받습니다." },
  };

  const cases: [string, (req: Request) => Promise<Response>][] = [
    ["POST /api/formats", (r) => formats.POST(r)],
    ["PUT /api/formats/[id]", (r) => formatItem.PUT(r, ctx("chat"))],
    ["POST /api/formats/defaults", (r) => formatDefaults.POST(r)],
    ["POST /api/history", (r) => history.POST(r)],
    ["PATCH /api/history/[id]", (r) => historyItem.PATCH(r, ctx("x"))],
  ];

  test.each(cases)("%s", async (name, call) => {
    const method = name.split(" ")[0];
    for (const req of [plain(method), noType(method)]) {
      const res = await call(req);
      expect(res.status).toBe(415);
      expect(await res.json()).toEqual(expected);
    }
  });

  test("415를 돌려준 요청은 데이터를 바꾸지 않는다", async () => {
    await formats.POST(plain("POST"));
    expect((await (await formats.GET()).json()).length).toBe(7);
    await formatItem.DELETE(request("DELETE"), ctx("jira"));
    await formatDefaults.POST(plain("POST"));
    expect((await (await formats.GET()).json()).length).toBe(6);
  });

  test("charset이 붙은 application/json은 받는다", async () => {
    const res = await formats.POST(
      new Request("http://localhost/api/x", {
        method: "POST",
        headers: { "Content-Type": "Application/JSON; charset=utf-8" },
        body,
      }),
    );
    expect(res.status).toBe(201);
  });
});

describe("잘못된 본문은 400", () => {
  test("PUT /api/formats/[id]는 이름이나 지시문이 없으면 400이고 포맷을 바꾸지 않는다", async () => {
    const res = await formatItem.PUT(request("PUT", { name: "  ", instruction: "x" }), ctx("chat"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_request");
    const list = await (await formats.GET()).json();
    expect(list.find((f: { id: string }) => f.id === "chat").name).toBe("채팅");
  });

  test("PUT /api/formats/[id]는 JSON 배열 본문도 400", async () => {
    const res = await formatItem.PUT(request("PUT", [1]), ctx("chat"));
    expect(res.status).toBe(400);
  });

  test("PATCH /api/history/[id]는 output이 없거나 문자열이 아니면 400", async () => {
    const created = await (
      await history.POST(
        request("POST", {
          formatId: "mail",
          formatName: "메일",
          recipient: "상사",
          tone: "격식",
          input: "내용",
          output: "결과",
        }),
      )
    ).json();
    for (const body of [{}, { output: 3 }, [1], null]) {
      const res = await historyItem.PATCH(request("PATCH", body), ctx(created.id));
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("bad_request");
    }
    const list = await (await history.GET()).json();
    expect(list[0].output).toBe("결과");
  });
});
