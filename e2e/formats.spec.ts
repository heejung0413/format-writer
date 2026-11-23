import { expect, test } from "./fixtures";

const DEFAULTS = ["메일", "채팅", "보고", "Jira 코멘트", "MR 본문", "리뷰 답글", "주간 보고"];

test.describe("포맷 관리", () => {
  test("포맷을 추가해 글을 쓰고, 이름을 고치고, 지우면 선택이 첫 포맷으로 돌아가며 하나 남으면 삭제가 막힌다", async ({ app, page }) => {
    const name = "주간보고";
    const instruction = "첫 줄에 이번 주 한 줄 요약을 쓰고 불릿으로 성과를 적는다.";
    const example = "이번 주 요약: 결제 개편 완료\n- 성과 1";
    await app.open();

    const modal = page.getByRole("heading", { name: "포맷 관리" }).locator("xpath=../..");
    const row = (title: string) => modal.getByRole("listitem").filter({ hasText: title });

    // 추가
    await page.getByRole("button", { name: "포맷 관리" }).click();
    await expect(page.getByRole("heading", { name: "새 포맷" })).toBeVisible();
    await expect(modal.getByRole("button", { name: "추가" })).toBeDisabled();
    await modal.getByPlaceholder(/^이름/).fill(name);
    await modal.getByPlaceholder(/^지시문/).fill(instruction);
    await modal.getByPlaceholder(/^예시 글/).fill(example);
    await modal.getByRole("button", { name: "추가" }).click();
    await expect(row(name)).toBeVisible();
    await modal.getByRole("button", { name: "닫기" }).click();
    await expect(app.formatSelect().getByRole("option")).toHaveText([...DEFAULTS, name]);
    expect(app.formats().map((f) => f.name)).toEqual([...DEFAULTS, name]);

    // 새 포맷으로 글 쓰기
    await app.generate("이번 주 결제 개편을 끝냈습니다", { format: name, recipient: "상사", tone: "보통" });
    await expect(app.result()).toHaveValue(`[${name}/상사/보통]\n이번 주 결제 개편을 끝냈습니다`);
    await app.untilIdle();
    const [call] = app.invocations();
    expect(call.system).toContain(`포맷: ${name}`);
    expect(call.system).toContain(`포맷 지시: ${instruction}`);
    expect(call.system).toContain(`<예시>\n${example}\n</예시>`);

    // 이름 수정
    await page.getByRole("button", { name: "포맷 관리" }).click();
    await row(name).getByRole("button", { name: "수정", exact: true }).click();
    await expect(page.getByRole("heading", { name: "포맷 수정" })).toBeVisible();
    await expect(modal.getByPlaceholder(/^이름/)).toHaveValue(name);
    await expect(modal.getByPlaceholder(/^예시 글/)).toHaveValue(example);
    await modal.getByPlaceholder(/^이름/).fill("주간 업무 보고");
    await modal.getByRole("button", { name: "수정 저장" }).click();
    await expect(row("주간 업무 보고")).toBeVisible();
    await expect(row(name)).toHaveCount(0);
    await modal.getByRole("button", { name: "닫기" }).click();
    await expect(app.formatSelect().getByRole("option")).toHaveText([...DEFAULTS, "주간 업무 보고"]);
    expect(app.formats().map((f) => f.name)).toContain("주간 업무 보고");

    // 선택된 포맷을 지우면 첫 포맷으로 돌아간다
    await expect(app.formatSelect()).toHaveValue(app.formats()[7].id);
    await page.getByRole("button", { name: "포맷 관리" }).click();
    await row("주간 업무 보고").getByRole("button", { name: "삭제" }).click();
    await expect(row("주간 업무 보고")).toHaveCount(0);
    await modal.getByRole("button", { name: "닫기" }).click();
    await expect(app.formatSelect().getByRole("option")).toHaveText(DEFAULTS);
    await expect(app.formatSelect()).toHaveValue("mail");

    // 하나만 남으면 삭제할 수 없다
    await page.getByRole("button", { name: "포맷 관리" }).click();
    // "보고"가 "주간 보고"에도 들어 있어 뒤에서부터 지운다.
    for (const title of DEFAULTS.slice(1).reverse()) {
      await expect(row(title).getByRole("button", { name: "삭제" })).toBeEnabled();
      await row(title).getByRole("button", { name: "삭제" }).click();
      await expect(row(title)).toHaveCount(0);
    }
    await expect(modal.getByRole("listitem")).toHaveCount(1);
    await expect(row("메일").getByRole("button", { name: "삭제" })).toBeDisabled();
    expect(app.formats().map((f) => f.name)).toEqual(["메일"]);
  });
});
