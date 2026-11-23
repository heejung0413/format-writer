// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { Format, HistoryItem } from "@/lib/types";
import { deferred, setupHarness } from "./harness";
import { reply } from "./fake-claude";
import { choose, formatNames, openHome, resultText, sidebar, submit, write } from "./ui";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { fakeSpawn } = await import("./fake-claude");
  return { ...actual, spawn: fakeSpawn };
});
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));

const h = setupHarness();

const NOTES = "내일 회의를 30분 미룹니다";
const OUTPUT = "제목: 회의 시간 변경 안내\n\n안녕하세요.\n내일 회의를 30분 늦춥니다.";

async function generateOnce(user: Awaited<ReturnType<typeof openHome>>["user"], output = OUTPUT) {
  h.claude.script(reply(output));
  await write(user, NOTES);
  await submit(user);
  await waitFor(() => expect(resultText()).toBe(output));
  await sidebar().findByRole("button", { name: new RegExp(NOTES) });
}

describe("처음 실행", () => {
  test("빈 데이터 폴더에서 기본 포맷 7개가 보이고 formats.json이 만들어진다", async () => {
    await openHome();

    expect(formatNames()).toEqual([
      "메일",
      "채팅",
      "보고",
      "Jira 코멘트",
      "MR 본문",
      "리뷰 답글",
      "주간 보고",
    ]);
    expect(screen.getByText("아직 기록이 없습니다.")).toBeInTheDocument();

    const saved = await h.readJson<Format[]>("formats.json");
    expect(saved.map((f) => [f.id, f.name])).toEqual([
      ["mail", "메일"],
      ["chat", "채팅"],
      ["report", "보고"],
      ["jira", "Jira 코멘트"],
      ["mr", "MR 본문"],
      ["review", "리뷰 답글"],
      ["weekly", "주간 보고"],
    ]);
    expect(saved.every((f) => f.instruction.length > 0)).toBe(true);
    expect(await h.readJson("history.json")).toEqual([]);
    expect(h.claude.runs).toHaveLength(0);
  });
});

describe("글 작성", () => {
  test("메일·상사·격식으로 작성하면 글이 흘러나오고 기록과 Claude 입력이 맞는다", async () => {
    const { user } = await openHome();
    const gate = deferred();
    h.claude.script(async (child) => {
      child.say("제목: 회의 시간 변경 안내\n\n");
      await gate.promise;
      child.say("안녕하세요.\n내일 회의를 30분 늦춥니다.");
      child.result();
      child.close(0);
    });

    await choose(user, "포맷", "메일");
    await choose(user, "받는 사람", "상사");
    await choose(user, "말투", "격식");
    await write(user, `  ${NOTES}  `);
    await submit(user);

    await waitFor(() => expect(resultText()).toBe("제목: 회의 시간 변경 안내\n\n"));
    expect(screen.getByRole("button", { name: "중단" })).toBeInTheDocument();
    expect(await h.readJson("history.json")).toEqual([]);

    gate.resolve();
    await waitFor(() => expect(resultText()).toBe(OUTPUT));
    const entry = await sidebar().findByRole("button", { name: new RegExp(NOTES) });
    expect(entry).toHaveTextContent("메일");

    const saved = await h.readJson<HistoryItem[]>("history.json");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      formatId: "mail",
      formatName: "메일",
      recipient: "상사",
      tone: "격식",
      input: NOTES,
      output: OUTPUT,
    });
    expect(saved[0].id).toBeTruthy();
    expect(Number.isNaN(Date.parse(saved[0].createdAt))).toBe(false);

    expect(h.claude.runs).toHaveLength(1);
    const [run] = h.claude.runs;
    expect(run.system).toContain("포맷: 메일");
    expect(run.system).toContain("첫 줄에 '제목: ...'을 쓴다.");
    expect(run.system).toContain("받는 사람: 상사");
    expect(run.system).toContain("말투: 격식 (합쇼체 '~습니다'를 쓰고 정중하게)");
    expect(run.stdin).toBe(NOTES);
    expect(run.args[run.args.indexOf("--tools") + 1]).toBe("");
    expect(run.args).toContain("stream-json");
    expect(Object.keys(run.env).filter((k) => k.startsWith("ANTHROPIC_"))).toEqual([]);
    expect(run.env.PATH).toBe(process.env.PATH);
    expect(process.env.ANTHROPIC_API_KEY).toBe("sk-ant-integration-test");
  });

  test("받는 사람을 고르지 않으면 지시문에 받는 사람 줄이 없다", async () => {
    const { user } = await openHome();
    await generateOnce(user);
    expect(h.claude.runs[0].system).not.toContain("받는 사람:");
    expect(h.claude.runs[0].system).toContain("말투: 보통 (해요체");
  });

  test("더 짧게를 누르면 원문, 첫 글, 지시가 차례로 전달되고 같은 기록이 갱신된다", async () => {
    const { user } = await openHome();
    await generateOnce(user);
    const [first] = await h.readJson<HistoryItem[]>("history.json");

    h.claude.script(reply("내일 회의는 30분 늦춥니다."));
    await user.click(await screen.findByRole("button", { name: "더 짧게" }));
    await waitFor(() => expect(resultText()).toBe("내일 회의는 30분 늦춥니다."));
    await waitFor(async () => {
      const [item] = await h.readJson<HistoryItem[]>("history.json");
      expect(item.output).toBe("내일 회의는 30분 늦춥니다.");
    });

    const { stdin } = h.claude.runs[1];
    const at = [NOTES, OUTPUT, "더 짧게"].map((part) => stdin.indexOf(part));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(stdin.indexOf("더 짧게", stdin.indexOf(OUTPUT))).toBe(at[2]);

    const saved = await h.readJson<HistoryItem[]>("history.json");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual({ ...first, output: "내일 회의는 30분 늦춥니다." });
    expect(h.requests.filter((r) => r.method === "PATCH")).toEqual([
      { method: "PATCH", path: `/api/history/${first.id}` },
    ]);
  });

  test("직접 쓴 수정 지시도 같은 기록의 결과만 바꾼다", async () => {
    const { user } = await openHome();
    await generateOnce(user);
    h.claude.script(reply("마지막 문단을 뺀 글"));
    await user.type(screen.getByPlaceholderText(/수정 지시를 입력하세요/), "마지막 문단 빼 줘{Enter}");
    await waitFor(() => expect(resultText()).toBe("마지막 문단을 뺀 글"));
    expect(h.claude.runs[1].stdin).toContain("<수정 지시>\n마지막 문단 빼 줘\n</수정 지시>");
    await waitFor(async () => {
      expect((await h.readJson<HistoryItem[]>("history.json"))[0].output).toBe("마지막 문단을 뺀 글");
    });
  });
});

describe("다시 열기와 삭제", () => {
  test("새로 열어도 기록이 남아 있고 누르면 복원되며 다듬기는 같은 기록을 고친다", async () => {
    const first = await openHome();
    await choose(first.user, "받는 사람", "상사");
    await choose(first.user, "말투", "격식");
    await generateOnce(first.user);
    const [before] = await h.readJson<HistoryItem[]>("history.json");
    first.unmount();

    const { user } = await openHome();
    const entry = await sidebar().findByRole("button", { name: new RegExp(NOTES) });
    expect(screen.getByPlaceholderText(/전하고 싶은 내용을/)).toHaveValue("");
    await user.click(entry);

    expect(screen.getByPlaceholderText(/전하고 싶은 내용을/)).toHaveValue(NOTES);
    expect(screen.getByLabelText("포맷")).toHaveValue("mail");
    expect(screen.getByLabelText("받는 사람")).toHaveValue("상사");
    expect(screen.getByLabelText("말투")).toHaveValue("격식");
    expect(resultText()).toBe(OUTPUT);

    h.claude.script(reply("복원 뒤에 고친 글"));
    await user.click(await screen.findByRole("button", { name: "더 공손하게" }));
    await waitFor(() => expect(resultText()).toBe("복원 뒤에 고친 글"));
    await waitFor(async () => {
      const saved = await h.readJson<HistoryItem[]>("history.json");
      expect(saved).toHaveLength(1);
      expect(saved[0]).toEqual({ ...before, output: "복원 뒤에 고친 글" });
    });
    const { stdin } = h.claude.runs[1];
    expect(stdin.indexOf(NOTES)).toBeLessThan(stdin.indexOf(OUTPUT));
    expect(stdin.indexOf(OUTPUT)).toBeLessThan(stdin.indexOf("더 공손하게"));
  });

  test("기록을 지우면 화면과 history.json에서 그 항목만 사라진다", async () => {
    const { user } = await openHome();
    await generateOnce(user);
    h.claude.script(reply("두 번째 글"));
    await write(user, "두 번째 메모");
    await submit(user);
    await sidebar().findByRole("button", { name: /두 번째 메모/ });
    expect(await h.readJson<HistoryItem[]>("history.json")).toHaveLength(2);

    const second = (await sidebar().findAllByRole("listitem"))[0];
    expect(second).toHaveTextContent("두 번째 메모");
    await user.click(sidebar().getAllByRole("button", { name: "기록 삭제" })[0]);

    await waitFor(() =>
      expect(sidebar().queryByRole("button", { name: /두 번째 메모/ })).not.toBeInTheDocument(),
    );
    expect(sidebar().getByRole("button", { name: new RegExp(NOTES) })).toBeInTheDocument();
    const saved = await h.readJson<HistoryItem[]>("history.json");
    expect(saved.map((item) => item.input)).toEqual([NOTES]);
  });

  test("기록이 200건이면 새 글이 맨 앞에 들어가고 가장 오래된 것이 밀려난다", async () => {
    const seeded: HistoryItem[] = Array.from({ length: 200 }, (_, i) => ({
      id: `old-${i}`,
      createdAt: new Date(2026, 0, 1, 0, 0, 0, 0 - i).toISOString(),
      formatId: "chat",
      formatName: "채팅",
      recipient: "동료",
      tone: "보통",
      input: `예전 메모 ${i}`,
      output: `예전 글 ${i}`,
    }));
    await h.writeJson("history.json", seeded);

    const { user } = await openHome();
    await generateOnce(user);

    await waitFor(async () => {
      const saved = await h.readJson<HistoryItem[]>("history.json");
      expect(saved).toHaveLength(200);
      expect(saved[0].input).toBe(NOTES);
      expect(saved[1].id).toBe("old-0");
      expect(saved[199].id).toBe("old-198");
      expect(saved.some((item) => item.id === "old-199")).toBe(false);
    });
  }, 30_000);
});
