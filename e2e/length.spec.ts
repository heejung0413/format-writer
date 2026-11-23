import { expect, test } from "./fixtures";

test.describe("길이 옵션", () => {
  test("짧게를 고르면 지시문에 길이 줄이 들어가고, 보통이면 들어가지 않는다", async ({ app }) => {
    await app.open();
    await expect(app.lengthSelect()).toHaveValue("보통");
    await app.lengthSelect().selectOption({ label: "짧게" });
    await app.generate("분기 보고서 일정을 알립니다");
    await expect(app.result()).toHaveValue(/\[길이: 짧게\]$/);
    await app.untilIdle();

    const short = app.invocations()[0];
    expect(short.system).toContain("길이: 짧게 (핵심만 남겨 가능한 한 짧게 쓴다)");
    expect(short.stdin).not.toContain("길이");

    await app.lengthSelect().selectOption({ label: "보통" });
    await app.generate("다른 메모입니다");
    await expect(app.result()).toHaveValue("[메일/없음/보통]\n다른 메모입니다");
    await app.untilIdle();
    expect(app.invocations()[1].system).not.toMatch(/^길이:/m);
  });

  test("자세히로 쓴 기록은 새로고침 뒤 열면 길이가 복원되고 다듬기도 같은 길이를 쓴다", async ({ app, page }) => {
    const notes = "프로젝트 배경을 설명합니다";
    await app.open();
    await app.lengthSelect().selectOption({ label: "자세히" });
    await app.generate(notes);
    await expect(app.result()).toHaveValue(/\[길이: 자세히\]$/);
    await app.untilIdle();
    await expect.poll(() => app.history()[0]?.length).toBe("자세히");

    await page.reload();
    await expect(app.formatSelect().getByRole("option")).not.toHaveCount(0);
    await expect(app.lengthSelect()).toHaveValue("보통");
    await app.historyEntry(notes).click();
    await expect(app.lengthSelect()).toHaveValue("자세히");

    await page.getByRole("button", { name: "더 짧게" }).click();
    await expect(app.result()).toHaveValue(/수정 1회 \(더 짧게\)[\s\S]*\[길이: 자세히\]$/);
    await app.untilIdle();
    expect(app.invocations()[1].system).toContain("길이: 자세히 (배경과 이유까지 풀어서 자세히 쓴다)");
  });
});
