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

describe("buildSystemPrompt 길이", () => {
  const base = { format, recipient: "없음", tone: "보통" };

  test("짧게이면 핵심만 짧게 쓰라는 줄이 들어간다", () => {
    expect(buildSystemPrompt({ ...base, length: "짧게" })).toContain(
      "길이: 짧게 (핵심만 남겨 가능한 한 짧게 쓴다)",
    );
  });

  test("자세히이면 배경과 이유까지 풀어 쓰라는 줄이 들어간다", () => {
    expect(buildSystemPrompt({ ...base, length: "자세히" })).toContain(
      "길이: 자세히 (배경과 이유까지 풀어서 자세히 쓴다)",
    );
  });

  test("보통이거나 길이를 안 주면 길이 줄이 없다", () => {
    expect(buildSystemPrompt({ ...base, length: "보통" })).not.toContain("길이:");
    expect(buildSystemPrompt(base)).not.toContain("길이:");
  });

  test("길이 줄은 말투 줄 바로 뒤에 온다", () => {
    const lines = buildSystemPrompt({ ...base, length: "짧게" }).split("\n");
    const at = lines.findIndex((l) => l.startsWith("말투:"));
    expect(lines[at + 1]).toMatch(/^길이: 짧게/);
  });
});

describe("buildSystemPrompt 알 수 없는 말투", () => {
  test("지침 표에 없는 말투는 이름 그대로 넣는다", () => {
    const prompt = buildSystemPrompt({ format, recipient: "없음", tone: "엉뚱한말투" });
    expect(prompt).toContain("말투: 엉뚱한말투");
  });
});
