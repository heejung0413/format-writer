import { describe, expect, test } from "vitest";
import { parseFormatInput } from "@/lib/format-input";

describe("parseFormatInput", () => {
  test("이름·지시문·예시를 모두 받는다", () => {
    expect(parseFormatInput({ name: "주간보고", instruction: "요약", example: "예시" })).toEqual({
      name: "주간보고",
      instruction: "요약",
      example: "예시",
    });
  });

  test("세 값 모두 앞뒤 공백을 자른다", () => {
    expect(
      parseFormatInput({ name: "  이름 ", instruction: "\n지시\t", example: "  예시  " }),
    ).toEqual({ name: "이름", instruction: "지시", example: "예시" });
  });

  test("예시가 없으면 example 키를 만들지 않는다", () => {
    const result = parseFormatInput({ name: "a", instruction: "b" });
    expect(result).toEqual({ name: "a", instruction: "b" });
    expect(result).not.toHaveProperty("example");
  });

  test("예시가 공백뿐이면 example 키를 만들지 않는다", () => {
    expect(parseFormatInput({ name: "a", instruction: "b", example: "  \n " })).not.toHaveProperty(
      "example",
    );
  });

  test("예시가 문자열이 아니면 무시한다", () => {
    expect(parseFormatInput({ name: "a", instruction: "b", example: 5 })).toEqual({
      name: "a",
      instruction: "b",
    });
  });

  test("이름이 없거나 공백이면 null", () => {
    expect(parseFormatInput({ instruction: "b" })).toBeNull();
    expect(parseFormatInput({ name: "   ", instruction: "b" })).toBeNull();
  });

  test("지시문이 없거나 공백이면 null", () => {
    expect(parseFormatInput({ name: "a" })).toBeNull();
    expect(parseFormatInput({ name: "a", instruction: " \t" })).toBeNull();
  });

  test("이름이나 지시문이 문자열이 아니면 null", () => {
    expect(parseFormatInput({ name: 1, instruction: "b" })).toBeNull();
    expect(parseFormatInput({ name: "a", instruction: ["b"] })).toBeNull();
  });

  test("null·undefined·원시값·빈 객체는 null", () => {
    expect(parseFormatInput(null)).toBeNull();
    expect(parseFormatInput(undefined)).toBeNull();
    expect(parseFormatInput("text")).toBeNull();
    expect(parseFormatInput(7)).toBeNull();
    expect(parseFormatInput({})).toBeNull();
  });
});
