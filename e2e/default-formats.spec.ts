import { expect, test } from "./fixtures";

const DEFAULTS = ["메일", "채팅", "보고", "Jira 코멘트", "MR 본문", "리뷰 답글", "주간 보고"];

test.describe("기본 포맷 불러오기", () => {
  test("지운 기본 포맷만 목록 끝에 돌아오고, 직접 만든 포맷과 고친 기본 포맷은 그대로이며, 다시 누르면 추가할 것이 없다", async ({ app, page }) => {
    await app.open();
    await expect(app.formatSelect().getByRole("option")).toHaveText(DEFAULTS);

    await page.getByRole("button", { name: "포맷 관리" }).click();
    const dialog = page.getByRole("dialog", { name: "포맷 관리" });
    const row = (title: string) =>
      dialog.getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) });

    // 기본 포맷 두 개를 지우고, 직접 만든 포맷을 하나 더하고, 기본 포맷 하나의 이름을 고친다.
    for (const title of ["채팅", "리뷰 답글"]) {
      await row(title).getByRole("button", { name: "삭제" }).click();
      await expect(row(title)).toHaveCount(0);
    }
    await dialog.getByPlaceholder(/^이름/).fill("내 포맷");
    await dialog.getByPlaceholder(/^지시문/).fill("내가 만든 지시문");
    await dialog.getByRole("button", { name: "추가" }).click();
    await expect(row("내 포맷")).toBeVisible();
    await row("메일").getByRole("button", { name: "수정", exact: true }).click();
    await dialog.getByPlaceholder(/^이름/).fill("메일(내 버전)");
    await dialog.getByRole("button", { name: "수정 저장" }).click();
    await expect(row("메일(내 버전)")).toBeVisible();

    const before = app.formats();
    expect(before.map((f) => f.name)).toEqual(["메일(내 버전)", "보고", "Jira 코멘트", "MR 본문", "주간 보고", "내 포맷"]);

    await dialog.getByRole("button", { name: "기본 포맷 불러오기" }).click();
    await expect(dialog.getByRole("status")).toHaveText("기본 포맷 2개를 추가했습니다.");
    await expect(dialog.getByRole("listitem").locator("span.font-medium")).toHaveText([
      "메일(내 버전)",
      "보고",
      "Jira 코멘트",
      "MR 본문",
      "주간 보고",
      "내 포맷",
      "채팅",
      "리뷰 답글",
    ]);
    const after = app.formats();
    expect(after.map((f) => f.name)).toEqual([...before.map((f) => f.name), "채팅", "리뷰 답글"]);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(-2).map((f) => f.id)).toEqual(["chat", "review"]);

    await dialog.getByRole("button", { name: "기본 포맷 불러오기" }).click();
    await expect(dialog.getByRole("status")).toHaveText("추가할 기본 포맷이 없습니다.");
    expect(app.formats()).toEqual(after);

    await dialog.getByRole("button", { name: "닫기" }).click();
    await expect(app.formatSelect().getByRole("option")).toHaveText([
      "메일(내 버전)",
      "보고",
      "Jira 코멘트",
      "MR 본문",
      "주간 보고",
      "내 포맷",
      "채팅",
      "리뷰 답글",
    ]);
  });
});
