import { describe, expect, test } from "vitest";
import { buildSystemPrompt } from "@/lib/prompt";

const format = { id: "mail", name: "메일", instruction: "제목 줄을 쓴다." };

describe("buildSystemPrompt", () => {
  test("포맷 이름과 지시문이 들어간다", () => {
    const prompt = buildSystemPrompt({ format, recipient: "없음", tone: "보통" });
    expect(prompt).toContain("포맷: 메일");
    expect(prompt).toContain("제목 줄을 쓴다.");
  });

  test("완성된 글만 출력하고 사실을 지어내지 않는 규칙이 들어간다", () => {
    const prompt = buildSystemPrompt({ format, recipient: "없음", tone: "보통" });
    expect(prompt).toContain("완성된 글만 출력");
    expect(prompt).toContain("지어내지 않는다");
    expect(prompt).toContain("[날짜]");
  });

  test("받는 사람이 '없음'이면 받는 사람 줄이 없다", () => {
    const prompt = buildSystemPrompt({ format, recipient: "없음", tone: "보통" });
    expect(prompt).not.toContain("받는 사람:");
  });

  test("받는 사람과 말투가 들어간다", () => {
    const prompt = buildSystemPrompt({ format, recipient: "상사", tone: "격식" });
    expect(prompt).toContain("받는 사람: 상사");
    expect(prompt).toContain("말투: 격식");
  });

  test("예시가 있으면 예시 구역이 들어가고, 없으면 들어가지 않는다", () => {
    const withExample = buildSystemPrompt({
      format: { ...format, example: "제목: 회의 일정 안내" },
      recipient: "없음",
      tone: "보통",
    });
    expect(withExample).toContain("<예시>");
    expect(withExample).toContain("제목: 회의 일정 안내");

    const without = buildSystemPrompt({ format, recipient: "없음", tone: "보통" });
    expect(without).not.toContain("<예시>");
  });

  test("공백뿐인 예시는 없는 것으로 본다", () => {
    const prompt = buildSystemPrompt({
      format: { ...format, example: "   " },
      recipient: "없음",
      tone: "보통",
    });
    expect(prompt).not.toContain("<예시>");
  });
});
