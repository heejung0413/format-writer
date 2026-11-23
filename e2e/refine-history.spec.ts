import { expect, test } from "./fixtures";

test.describe("다듬기", () => {
  test("빠른 버튼과 Enter로 보낸 수정 지시가 각각 결과를 바꾸고 기록은 한 건으로 유지된다", async ({ app }) => {
    const notes = "프로젝트 일정이 이틀 늦어질 것 같습니다";
    await app.open();
    await app.generate(notes);
    await expect(app.result()).toHaveText(`[메일/없음/보통] ${notes}`);
    await app.untilIdle();

    await app.page.getByRole("button", { name: "더 짧게" }).click();
    await expect(app.result()).toHaveText(`[메일/없음/보통] 수정 1회 (더 짧게) ${notes}`);
    await app.untilIdle();

    await app.refineInput().fill("마지막 문단 빼 줘");
    await app.refineInput().press("Enter");
    await expect(app.result()).toHaveText(`[메일/없음/보통] 수정 2회 (마지막 문단 빼 줘) ${notes}`);
    await app.untilIdle();

    await expect(app.sidebar().getByRole("listitem")).toHaveCount(1);
    const saved = app.history();
    expect(saved).toHaveLength(1);
    expect(saved[0].output).toBe(await app.resultText());
    expect(saved[0].output).toContain("수정 2회 (마지막 문단 빼 줘)");

    const refineCall = app.invocations()[2];
    expect(refineCall.stdin).toContain(`<원문>\n${notes}\n</원문>`);
    expect(refineCall.stdin).toContain("<수정 지시>\n더 짧게\n</수정 지시>");
    expect(refineCall.stdin).toContain("<수정 지시>\n마지막 문단 빼 줘\n</수정 지시>");
  });
});

test.describe("새로고침 후 유지", () => {
  test("새로고침해도 기록이 남고 눌러서 입력·옵션·결과를 복원한 뒤 다듬으면 같은 기록이 갱신된다", async ({ app, page }) => {
    const notes = "신제품 출시 일정 공유";
    await app.open();
    await app.generate(notes, { format: "채팅", recipient: "동료", tone: "편하게" });
    await expect(app.result()).toHaveText(`[채팅/동료/편하게] ${notes}`);
    await app.untilIdle();
    await expect(app.historyEntry(notes)).toBeVisible();

    await page.reload();
    await expect(app.formatSelect().getByRole("option")).not.toHaveCount(0);
    await expect(app.result()).toHaveCount(0);
    await expect(app.historyEntry(notes)).toBeVisible();

    // 다른 옵션으로 바꿔 둔 뒤 기록을 눌러 원래 값으로 돌아오는지 본다.
    await app.formatSelect().selectOption({ label: "보고" });
    await app.recipientSelect().selectOption({ label: "고객" });
    await app.toneSelect().selectOption({ label: "격식" });
    await app.write("다른 메모");
    await app.historyEntry(notes).click();

    await expect(app.notes()).toHaveValue(notes);
    await expect(app.formatSelect()).toHaveValue("chat");
    await expect(app.recipientSelect()).toHaveValue("동료");
    await expect(app.toneSelect()).toHaveValue("편하게");
    await expect(app.result()).toHaveText(`[채팅/동료/편하게] ${notes}`);

    await page.getByRole("button", { name: "더 공손하게" }).click();
    await expect(app.result()).toHaveText(`[채팅/동료/편하게] 수정 1회 (더 공손하게) ${notes}`);
    await app.untilIdle();

    await expect(app.sidebar().getByRole("listitem")).toHaveCount(1);
    const saved = app.history();
    expect(saved).toHaveLength(1);
    expect(saved[0].output).toBe(`[채팅/동료/편하게] 수정 1회 (더 공손하게)\n${notes}`);
  });
});

test.describe("기록 삭제", () => {
  test("× 버튼으로 기록을 지우면 화면과 파일에서 사라지고 새로고침해도 돌아오지 않는다", async ({ app, page }) => {
    const notes = "지울 기록";
    await app.open();
    await app.generate(notes);
    await expect(app.result()).toHaveText(`[메일/없음/보통] ${notes}`);
    await app.untilIdle();
    await expect(app.historyEntry(notes)).toBeVisible();

    await app.sidebar().getByRole("listitem").hover();
    await app.sidebar().getByRole("button", { name: "기록 삭제" }).click();

    await expect(app.historyEntry(notes)).toHaveCount(0);
    await expect(app.emptyHistory()).toBeVisible();
    await expect.poll(() => app.history()).toEqual([]);

    await page.reload();
    await expect(app.formatSelect().getByRole("option")).not.toHaveCount(0);
    await expect(app.emptyHistory()).toBeVisible();
    expect(app.history()).toEqual([]);
  });
});
