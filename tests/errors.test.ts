import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, test } from "vitest";
import { toErrorLine } from "@/lib/errors";

const headers = new Headers();

describe("toErrorLine", () => {
  test("인증 오류는 auth", () => {
    const err = Anthropic.APIError.generate(401, undefined, "invalid x-api-key", headers);
    expect(err).toBeInstanceOf(Anthropic.AuthenticationError);
    const line = toErrorLine(err);
    expect(line).toMatchObject({ type: "error", code: "auth" });
    expect(line.message).toContain("ANTHROPIC_API_KEY");
  });

  test("요청 한도 초과는 rate_limit", () => {
    const err = Anthropic.APIError.generate(429, undefined, "rate limited", headers);
    expect(toErrorLine(err)).toMatchObject({ type: "error", code: "rate_limit" });
  });

  test("그 밖의 API 오류는 api_error이고 상태 코드를 보여 준다", () => {
    const err = Anthropic.APIError.generate(500, undefined, "server exploded", headers);
    const line = toErrorLine(err);
    expect(line.code).toBe("api_error");
    expect(line.message).toContain("500");
  });

  test("API 오류가 아닌 SDK 오류(키 없음 등)는 auth", () => {
    const line = toErrorLine(new Anthropic.AnthropicError("no credentials"));
    expect(line.code).toBe("auth");
  });

  test("알 수 없는 오류는 api_error", () => {
    expect(toErrorLine(new Error("boom")).code).toBe("api_error");
    expect(toErrorLine("문자열").code).toBe("api_error");
  });
});
