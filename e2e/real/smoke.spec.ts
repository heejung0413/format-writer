import { expect, test } from "@playwright/test";

// 진짜 `claude` CLI를 부르는 시험이라 Claude Code 사용량이 듭니다. E2E_REAL_CLAUDE=1 일 때만 돌립니다.
test.skip(!process.env.E2E_REAL_CLAUDE, "E2E_REAL_CLAUDE=1 일 때만 실행합니다 (실제 Claude 사용량이 듭니다)");

test("진짜 claude로 짧은 메일을 쓰고 기록에 저장한다", async ({ page }) => {
  test.setTimeout(180_000);
  const notes = "내일 오전 10시 회의를 오후 3시로 옮겨도 되는지 팀장님께 여쭤보고 싶다";

  await page.goto("/");
  await expect(page.getByRole("combobox", { name: /^포맷/ }).getByRole("option")).not.toHaveCount(0);
  await page.getByPlaceholder(/전하고 싶은 내용을/).fill(notes);
  await page.getByRole("button", { name: "작성하기" }).click();

  await expect(page.getByRole("button", { name: "작성하기" })).toBeVisible({ timeout: 150_000 });
  await expect(page.getByText("Claude Code 요청에 실패했습니다")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "결과", exact: true })).not.toHaveValue("");
  await expect(page.getByRole("complementary").getByRole("button", { name: notes })).toBeVisible();
});
