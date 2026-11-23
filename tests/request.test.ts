import { describe, expect, test } from "vitest";
import { readJsonBody, unsupportedMediaType } from "@/lib/request";

function req(body: string, contentType?: string): Request {
  const headers: Record<string, string> = {};
  if (contentType !== undefined) headers["content-type"] = contentType;
  return new Request("http://localhost/api/x", { method: "POST", headers, body });
}

describe("unsupportedMediaType", () => {
  test("415와 JSON 오류 본문을 돌려준다", async () => {
    const res = unsupportedMediaType();
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({
      error: { code: "unsupported_media_type", message: "JSON 요청만 받습니다." },
    });
  });
});

describe("readJsonBody", () => {
  test("application/json이면 객체를 돌려준다", async () => {
    expect(await readJsonBody(req('{"a":1}', "application/json"))).toEqual({ a: 1 });
  });

  test("charset이 붙어도 받는다", async () => {
    expect(await readJsonBody(req('{"a":1}', "application/json; charset=utf-8"))).toEqual({ a: 1 });
  });

  test("대소문자와 공백이 달라도 받는다", async () => {
    expect(await readJsonBody(req('{"a":1}', "  Application/JSON  ;charset=UTF-8"))).toEqual({ a: 1 });
  });

  test("Content-Type이 없으면 415 Response", async () => {
    const result = await readJsonBody(new Request("http://localhost/x", { method: "POST" }));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(415);
  });

  test("text/plain이면 415 Response", async () => {
    const result = await readJsonBody(req('{"a":1}', "text/plain"));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(415);
  });

  test("application/jsonx처럼 비슷한 타입도 415", async () => {
    const result = await readJsonBody(req('{"a":1}', "application/jsonx"));
    expect(result).toBeInstanceOf(Response);
  });

  test("JSON이 깨졌으면 null", async () => {
    expect(await readJsonBody(req("{not json", "application/json"))).toBeNull();
  });

  test("본문이 비어 있으면 null", async () => {
    expect(await readJsonBody(req("", "application/json"))).toBeNull();
  });

  test("배열이면 null", async () => {
    expect(await readJsonBody(req("[1,2]", "application/json"))).toBeNull();
  });

  test("JSON null이면 null", async () => {
    expect(await readJsonBody(req("null", "application/json"))).toBeNull();
  });

  test("문자열·숫자·불리언이면 null", async () => {
    expect(await readJsonBody(req('"hi"', "application/json"))).toBeNull();
    expect(await readJsonBody(req("42", "application/json"))).toBeNull();
    expect(await readJsonBody(req("true", "application/json"))).toBeNull();
  });

  test("빈 객체는 그대로 돌려준다", async () => {
    expect(await readJsonBody(req("{}", "application/json"))).toEqual({});
  });
});
