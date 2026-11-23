import { expect, test } from "./fixtures";

const SIGNATURE = "홍길동\n개발팀 / 010-0000-0000\nhong@example.com";

test.describe("서명", () => {
  test("설정에 서명을 저장하면 메일 지시문에 들어가고, 새로고침 뒤에도 남으며, 지우면 다음 글에 들어가지 않는다", async ({ app, page }) => {
    await app.open();
    expect(app.settingsExists()).toBe(false);

    await page.getByRole("button", { name: "설정", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "설정" });
    await expect(dialog.getByLabel("서명")).toBeEnabled();
    await dialog.getByLabel("서명").fill(`  ${SIGNATURE}  `);
    await dialog.getByRole("button", { name: "저장" }).click();
    await expect(dialog).toHaveCount(0);
    expect(app.settings()).toEqual({ signature: SIGNATURE });

    await app.generate("회의록을 공유드립니다", { format: "메일" });
    await expect(app.result()).toHaveValue(`[메일/없음/보통]\n회의록을 공유드립니다\n--서명--\n${SIGNATURE}`);
    await app.untilIdle();
    const [first] = app.invocations();
    expect(first.system).toContain(`<서명>\n${SIGNATURE}\n</서명>`);
    expect(first.stdin).not.toContain("홍길동");

    await page.reload();
    await expect(app.formatSelect().getByRole("option")).not.toHaveCount(0);
    await page.getByRole("button", { name: "설정", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "설정" }).getByLabel("서명")).toHaveValue(SIGNATURE);

    await page.getByRole("dialog", { name: "설정" }).getByLabel("서명").fill("");
    await page.getByRole("dialog", { name: "설정" }).getByRole("button", { name: "저장" }).click();
    await expect(page.getByRole("dialog", { name: "설정" })).toHaveCount(0);
    expect(app.settings()).toEqual({ signature: "" });

    await app.generate("다음 메모입니다", { format: "메일" });
    await expect(app.result()).toHaveValue("[메일/없음/보통]\n다음 메모입니다");
    await app.untilIdle();
    const second = app.invocations()[1];
    expect(second.system).not.toContain("<서명>");
    expect(second.system).not.toContain("홍길동");
  });

  test("서명 입력 칸은 500자까지만 받고, 501자는 API가 400으로 거절해 저장되지 않는다", async ({ app, page, request }) => {
    await app.open();
    await page.getByRole("button", { name: "설정", exact: true }).click();
    const box = page.getByRole("dialog", { name: "설정" }).getByLabel("서명");
    await expect(box).toBeEnabled();
    await box.click();
    await page.keyboard.insertText("가".repeat(501));
    expect(await box.inputValue()).toHaveLength(500);
    await page.getByRole("dialog", { name: "설정" }).getByRole("button", { name: "저장" }).click();
    await expect(page.getByRole("dialog", { name: "설정" })).toHaveCount(0);
    expect(app.settings().signature).toHaveLength(500);

    const tooLong = await request.put("/api/settings", { data: { signature: "나".repeat(501) } });
    expect(tooLong.status()).toBe(400);
    const notString = await request.put("/api/settings", { data: { signature: 123 } });
    expect(notString.status()).toBe(400);
    expect(app.settings().signature).toBe("가".repeat(500));
    const current = await request.get("/api/settings");
    expect((await current.json()).signature).toBe("가".repeat(500));
  });
});
