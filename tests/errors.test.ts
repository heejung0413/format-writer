import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
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

  describe("API 오류가 아닌 SDK 오류", () => {
    const saved = {
      key: process.env.ANTHROPIC_API_KEY,
      token: process.env.ANTHROPIC_AUTH_TOKEN,
    };

    beforeEach(() => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_AUTH_TOKEN;
    });

    afterEach(() => {
      for (const [name, value] of [
        ["ANTHROPIC_API_KEY", saved.key],
        ["ANTHROPIC_AUTH_TOKEN", saved.token],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });

    test("키도 토큰도 없으면 auth", () => {
      const line = toErrorLine(new Anthropic.AnthropicError("no credentials"));
      expect(line.code).toBe("auth");
      expect(line.message).toContain("ANTHROPIC_API_KEY");
    });

    test("API 키가 있으면 중간에 끊긴 것으로 보고 api_error", () => {
      process.env.ANTHROPIC_API_KEY = "sk-test";
      expect(toErrorLine(new Anthropic.AnthropicError("socket hang up"))).toEqual({
        type: "error",
        code: "api_error",
        message: "작성이 중간에 끊겼습니다. 다시 시도해 주세요.",
      });
    });

    test("인증 토큰만 있어도 api_error", () => {
      process.env.ANTHROPIC_AUTH_TOKEN = "token";
      expect(toErrorLine(new Anthropic.AnthropicError("x")).code).toBe("api_error");
    });

    test("연결 실패는 키 유무와 상관없이 네트워크 안내", () => {
      const err = new Anthropic.APIConnectionError({ message: "Connection error." });
      expect(toErrorLine(err)).toEqual({
        type: "error",
        code: "api_error",
        message: "네트워크 연결에 실패했습니다. 연결을 확인하고 다시 시도해 주세요.",
      });
    });
  });

  test("알 수 없는 오류는 api_error", () => {
    expect(toErrorLine(new Error("boom")).code).toBe("api_error");
    expect(toErrorLine("문자열").code).toBe("api_error");
  });
});
