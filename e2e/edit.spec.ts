import { expect, test } from "./fixtures";

test.describe("결과 직접 편집", () => {
  test("고친 글은 저장됨이 보이고, 새로고침 뒤 그 기록을 열면 고친 글이 나오며 history.json에도 있다", async ({ app, page }) => {
    const notes = "이번 주 금요일에 점검이 있습니다";
    await app.open();
    await app.generate(notes);
    await expect(app.result()).toHaveValue(`[메일/없음/보통]\n${notes}`);
    await app.untilIdle();

    const edited = `[메일/없음/보통] ${notes}\n직접 덧붙인 문장입니다.`;
    await app.result().fill(edited);
    await expect(app.saveStatus()).toHaveText("저장됨");
    await expect.poll(() => app.history()[0].output).toBe(edited);
    expect(app.history()).toHaveLength(1);

    await page.reload();
    await expect(app.formatSelect().getByRole("option")).not.toHaveCount(0);
    await expect(app.result()).toHaveCount(0);
    await app.historyEntry(notes).click();
    await expect(app.result()).toHaveValue(edited);
    await expect(app.notes()).toHaveValue(notes);
  });

  test("고친 뒤 바로 더 짧게를 누르면 고친 글이 Claude에 전달되고, 기록은 다듬은 결과로 끝난다", async ({ app }) => {
    const notes = "다음 주 월요일 배포 일정을 공유합니다";
    await app.open();
    await app.generate(notes);
    await expect(app.result()).toHaveValue(`[메일/없음/보통]\n${notes}`);
    await app.untilIdle();

    const edited = "제가 직접 고친 첫 문장입니다.";
    await app.result().fill(edited);
    await app.page.getByRole("button", { name: "더 짧게" }).click();
    await expect(app.result()).toHaveValue(`[메일/없음/보통] 수정 1회 (더 짧게)\n${notes}`);
    await app.untilIdle();

    const refineCall = app.invocations()[1];
    expect(refineCall.stdin).toContain(`<작성한 글>\n${edited}\n</작성한 글>`);
    expect(refineCall.stdin.indexOf(edited)).toBeLessThan(refineCall.stdin.indexOf("<수정 지시>\n더 짧게"));

    const shown = await app.resultText();
    await expect.poll(() => app.history()[0].output).toBe(shown);
    expect(app.history()).toHaveLength(1);
    // 고친 글 저장이 뒤늦게 다듬은 결과를 덮어쓰지 않는지, 저장 대기 시간(1초)이 지난 뒤에도 본다.
    await expect(app.saveStatus()).toHaveCount(0);
    await expect.poll(() => app.history()[0].output, { timeout: 2500, intervals: [500] }).toBe(shown);
  });

  test("고친 뒤 바로 다른 기록을 열면 먼저 열었던 기록에 고친 글이 저장되고 다른 기록은 그대로다", async ({ app }) => {
    await app.open();
    await app.generate("첫 번째 메모");
    await expect(app.result()).toHaveValue("[메일/없음/보통]\n첫 번째 메모");
    await app.untilIdle();
    await app.generate("두 번째 메모");
    await expect(app.result()).toHaveValue("[메일/없음/보통]\n두 번째 메모");
    await app.untilIdle();
    await expect(app.sidebar().getByRole("listitem")).toHaveCount(2);

    await app.result().fill("두 번째 글을 고쳤습니다");
    await app.historyEntry("첫 번째 메모").click();

    await expect(app.result()).toHaveValue("[메일/없음/보통]\n첫 번째 메모");
    await expect(app.notes()).toHaveValue("첫 번째 메모");
    await expect
      .poll(() => app.history().find((h) => h.input === "두 번째 메모")?.output)
      .toBe("두 번째 글을 고쳤습니다");
    expect(app.history().find((h) => h.input === "첫 번째 메모")?.output).toBe("[메일/없음/보통]\n첫 번째 메모");
    await expect(app.saveStatus()).toHaveCount(0);

    // 열린 첫 번째 기록에는 저장 대기가 생기지 않는다.
    await expect.poll(() => app.history().find((h) => h.input === "첫 번째 메모")?.output, { timeout: 2500, intervals: [500] }).toBe(
      "[메일/없음/보통]\n첫 번째 메모",
    );
    await app.historyEntry("두 번째 메모").click();
    await expect(app.result()).toHaveValue("두 번째 글을 고쳤습니다");
  });

  test("작성 중에는 결과 칸이 읽기 전용이다", async ({ app }) => {
    await app.open();
    await app.generate("[[SLOW]] 아주 긴 글");
    await expect(app.result()).toHaveValue(/천천히 쓰는 중입니다\./);
    await expect(app.result()).not.toBeEditable();
    await app.stopButton().click();
    await expect(app.result()).toBeEditable();
  });
});
