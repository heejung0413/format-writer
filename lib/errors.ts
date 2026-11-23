import Anthropic from "@anthropic-ai/sdk";
import type { ErrorCode } from "./types";

export type ErrorLine = { type: "error"; code: ErrorCode; message: string };

const AUTH_MESSAGE = ".env.local에 ANTHROPIC_API_KEY를 넣고 서버를 다시 시작해 주세요.";

export function toErrorLine(err: unknown): ErrorLine {
  if (err instanceof Anthropic.AuthenticationError) {
    return { type: "error", code: "auth", message: AUTH_MESSAGE };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return {
      type: "error",
      code: "rate_limit",
      message: "요청이 많습니다. 잠시 후 다시 시도해 주세요.",
    };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return {
      type: "error",
      code: "api_error",
      message: "네트워크 연결에 실패했습니다. 연결을 확인하고 다시 시도해 주세요.",
    };
  }
  if (err instanceof Anthropic.APIError) {
    const status = err.status ? ` (${err.status})` : "";
    return {
      type: "error",
      code: "api_error",
      message: `Claude 요청에 실패했습니다${status}. 다시 시도해 주세요.`,
    };
  }
  if (err instanceof Anthropic.AnthropicError) {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      return { type: "error", code: "auth", message: AUTH_MESSAGE };
    }
    return {
      type: "error",
      code: "api_error",
      message: "작성이 중간에 끊겼습니다. 다시 시도해 주세요.",
    };
  }
  return {
    type: "error",
    code: "api_error",
    message: "알 수 없는 오류가 발생했습니다. 다시 시도해 주세요.",
  };
}
