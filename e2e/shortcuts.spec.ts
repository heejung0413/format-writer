import { expect, test } from "./fixtures";

test.describe("단축키", () => {
  test("Ctrl/⌘+Enter는 메모 입력 칸에서 작성하고 줄바꿈을 넣지 않으며, 그냥 Enter는 줄바꿈이다", async ({ app }) => {
    await app.open();
    await app.notes().click();
    await app.notes().pressSequentially("첫 줄");
    await app.notes().press("Enter");
    await app.notes().pressSequentially("둘째 줄");
    await expect(app.notes()).toHaveValue("첫 줄\n둘째 줄");
    await expect(app.stopButton()).toHaveCount(0);

    await app.notes().press("ControlOrMeta+Enter");
    await expect(app.result()).toHaveValue("[메일/없음/보통]\n첫 줄\n둘째 줄");
    await app.untilIdle();
    await expect(app.notes()).toHaveValue("첫 줄\n둘째 줄");
    expect(app.invocations()).toHaveLength(1);
    expect(app.history()).toHaveLength(1);
  });

  test("작성하기와 복사 버튼에 단축키가 작게 표시되고 버튼 이름은 그대로다", async ({ app, page }) => {
    await app.open();
    await app.write("표시 확인");
    const mac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform));
    await expect(app.generateButton()).toContainText(mac ? "⌘↵" : "Ctrl+Enter");
    await app.generateButton().click();
    await expect(app.result()).toHaveValue("[메일/없음/보통]\n표시 확인");
    await app.untilIdle();
    await expect(app.copyButton()).toContainText(mac ? "⌘⇧C" : "Ctrl+Shift+C");
    await expect(page.getByRole("button", { name: "복사", exact: true })).toBeVisible();
  });

  test("Ctrl/⌘+Shift+C는 고친 글을 클립보드에 담고 복사됨을 보인다", async ({ app, page, context, baseURL }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL });
    await app.open();
    await app.generate("복사 단축키 확인");
    await expect(app.result()).toHaveValue("[메일/없음/보통]\n복사 단축키 확인");
    await app.untilIdle();

    await app.notes().click();
    await page.keyboard.press("ControlOrMeta+Shift+C");
    await expect(page.getByRole("button", { name: "복사됨" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("[메일/없음/보통]\n복사 단축키 확인");
    await expect(app.copyButton()).toHaveText(/^복사/);
    await expect(page.getByRole("button", { name: "복사됨" })).toHaveCount(0);

    await app.result().fill("고친 글을 복사합니다");
    await page.keyboard.press("ControlOrMeta+Shift+C");
    await expect(page.getByRole("button", { name: "복사됨" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("고친 글을 복사합니다");
  });

  test("포맷 관리 창이 열려 있으면 Ctrl/⌘+Enter로 작성하지 않고, 닫으면 다시 된다", async ({ app, page }) => {
    await app.open();
    await app.write("[[SLOW]] 창이 열려 있을 때");
    await page.getByRole("button", { name: "포맷 관리" }).click();
    const dialog = page.getByRole("dialog", { name: "포맷 관리" });
    await expect(dialog).toBeVisible();

    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(app.stopButton()).toHaveCount(0);
    expect(app.invocations()).toHaveLength(0);
    await dialog.getByRole("button", { name: "닫기" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(app.stopButton()).toHaveCount(0);
    expect(app.invocations()).toHaveLength(0);
    expect(app.history()).toEqual([]);

    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(app.stopButton()).toBeVisible();
    await app.stopButton().click();
    await expect(app.generateButton()).toBeEnabled();
  });
});
