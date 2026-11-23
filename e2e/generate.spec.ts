import { expect, test } from "./fixtures";

test.describe("첫 화면", () => {
  test("제목, 기본 포맷 3개, 빈 기록 안내가 보이고 작성하기는 글을 쓸 때까지 막혀 있다", async ({ app, page }) => {
    await app.open();

    await expect(page).toHaveTitle("포맷 글 작성기");
    await expect(page.getByRole("heading", { name: "포맷 글 작성기" })).toBeVisible();
    await expect(app.formatSelect().getByRole("option")).toHaveText(["메일", "채팅", "보고"]);
    await expect(app.emptyHistory()).toBeVisible();
    await expect(app.generateButton()).toBeDisabled();

    await app.write("   ");
    await expect(app.generateButton()).toBeDisabled();
    await app.write("내일 회의 시간 바꾸자");
    await expect(app.generateButton()).toBeEnabled();
  });
});

test.describe("글 작성", () => {
  test("작성하는 동안 중단 버튼으로 바뀌고 글이 조금씩 늘어나 선택한 옵션이 반영된 글로 끝난다", async ({ app }) => {
    const notes = "다음 주 화요일 회의를 수요일 오후로 옮기고 싶습니다";
    await app.open();
    await app.generate(notes, { format: "메일", recipient: "상사", tone: "격식" });

    await expect(app.stopButton()).toBeVisible();
    await expect(app.generateButton()).toHaveCount(0);

    const final = `[메일/상사/격식] ${notes}`;
    await expect
      .poll(async () => (await app.resultText()).length, { message: "글이 일부만 보이는 순간이 있어야 한다" })
      .toBeGreaterThan(0);
    // 일부만 나온 상태: 끝난 글보다 짧고, 끝난 글의 앞부분이다.
    await expect
      .poll(async () => {
        const text = await app.resultText();
        return text.length > 0 && text.length < final.length && final.startsWith(text);
      })
      .toBe(true);

    await expect(app.result()).toHaveText(final);
    await app.untilIdle();
    await expect(app.stopButton()).toHaveCount(0);

    await expect(app.historyEntry(notes)).toBeVisible();
    await expect(app.sidebar()).toContainText("메일");
    await expect(app.emptyHistory()).toHaveCount(0);
    expect(app.history()).toHaveLength(1);

    const calls = app.invocations();
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.system).toContain("포맷: 메일");
    expect(call.system).toContain("첫 줄에 '제목: ...'을 쓴다.");
    expect(call.system).toContain("받는 사람: 상사");
    expect(call.system).toContain("말투: 격식 (합쇼체 '~습니다'를 쓰고 정중하게)");
    expect(call.stdin).toBe(notes);
    expect(call.argv).toContain("--system-prompt");
    expect(call.leakedEnvKeys).toEqual([]);
  });

  test("받는 사람을 없음으로 두면 시스템 지시문에 받는 사람 줄이 들어가지 않는다", async ({ app }) => {
    await app.open();
    await app.generate("점심 뭐 먹을지 정해 줘", { format: "채팅" });
    await expect(app.result()).toHaveText("[채팅/없음/보통] 점심 뭐 먹을지 정해 줘");
    await app.untilIdle();

    expect(app.invocations()[0].system).not.toContain("받는 사람:");
  });
});

test.describe("복사", () => {
  test("복사를 누르면 클립보드에 결과가 담기고 버튼이 복사됨으로 바뀐다", async ({ app, page, context, baseURL }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL });
    await app.open();
    await app.generate("분기 매출 요약 부탁드려요");
    await expect(app.result()).toHaveText("[메일/없음/보통] 분기 매출 요약 부탁드려요");
    await app.untilIdle();

    const shown = await app.resultText();
    await app.copyButton().click();
    await expect(page.getByRole("button", { name: "복사됨" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shown);
  });
});

test.describe("중단", () => {
  test("중단하면 작성하기가 돌아오고 받은 글은 남지만 기록에는 저장되지 않으며 claude 프로세스가 종료된다", async ({ app }) => {
    await app.open();
    await app.generate("[[SLOW]] 아주 긴 글");

    await expect(app.result()).toContainText("천천히 쓰는 중입니다.");
    await app.stopButton().click();

    await expect(app.generateButton()).toBeEnabled();
    await expect(app.stopButton()).toHaveCount(0);
    await expect(app.result()).toContainText("천천히 쓰는 중입니다.");
    await expect(app.emptyHistory()).toBeVisible();
    expect(app.history()).toEqual([]);

    await expect.poll(() => app.sigtermCount(), { timeout: 3000, message: "claude가 SIGTERM을 받아야 한다" }).toBe(1);
    expect(app.invocations()).toHaveLength(1);
  });
});

test.describe("오류 표시", () => {
  test("claude가 사유와 함께 오류를 알리면 그 사유가 배너로 나오고 다시 시도 버튼이 있으며 저장되지 않는다", async ({ app }) => {
    await app.open();
    await app.generate("[[ERROR:사용 한도에 도달했습니다]] 메모");

    await expect(app.page.getByText("Claude Code 요청에 실패했습니다: 사용 한도에 도달했습니다")).toBeVisible();
    await expect(app.retryButton()).toBeVisible();
    await app.untilIdle();
    await expect(app.emptyHistory()).toBeVisible();
    expect(app.history()).toEqual([]);
  });

  test("claude가 stderr만 남기고 비정상 종료하면 그 내용이 배너에 나온다", async ({ app }) => {
    await app.open();
    await app.generate("[[EXIT]] 메모");

    await expect(
      app.page.getByText("Claude Code 요청에 실패했습니다: fake claude: 로그인이 필요합니다 (e2e)"),
    ).toBeVisible();
    await expect(app.retryButton()).toBeVisible();
    expect(app.history()).toEqual([]);
  });

  test("claude가 거절하면 이 내용은 작성할 수 없다는 안내가 나온다", async ({ app }) => {
    await app.open();
    await app.generate("[[REFUSE]] 메모");

    await expect(app.page.getByText("이 내용은 작성할 수 없습니다.")).toBeVisible();
    await expect(app.emptyHistory()).toBeVisible();
    expect(app.history()).toEqual([]);
  });

  test("첫 시도가 실패해도 다시 시도를 누르면 글이 나오고 기록이 한 건 저장된다", async ({ app }) => {
    await app.open();
    await app.generate("[[FLAKY]] 재시도 메모");

    await expect(app.page.getByText("Claude Code 요청에 실패했습니다: 일시적인 오류 (e2e)")).toBeVisible();
    await app.retryButton().click();

    await expect(app.result()).toHaveText("[메일/없음/보통] [[FLAKY]] 재시도 메모");
    await expect(app.page.getByText("Claude Code 요청에 실패했습니다")).toHaveCount(0);
    await app.untilIdle();
    await expect(app.historyEntry("[[FLAKY]] 재시도 메모")).toBeVisible();
    expect(app.history()).toHaveLength(1);
    expect(app.invocations()).toHaveLength(2);
  });
});

test.describe("다른 사이트의 요청 차단", () => {
  test("Content-Type이 text/plain인 생성 요청은 415로 거절되고 claude는 실행되지 않는다", async ({ app, request }) => {
    const before = app.invocations().length;
    const res = await request.post("/api/generate", {
      headers: { "Content-Type": "text/plain" },
      data: JSON.stringify({ input: "몰래 보낸 요청", formatId: "mail", recipient: "없음", tone: "보통" }),
    });

    expect(res.status()).toBe(415);
    expect(app.invocations()).toHaveLength(before);
  });
});
