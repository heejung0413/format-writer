// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { HistoryItem } from "@/lib/types";
import { advance, fakeSaveTimers, realSaveTimers } from "../fake-timers";
import { setupHarness } from "./harness";
import { reply } from "./fake-claude";
import { openHome, resultBox, resultText, sidebar, submit, write } from "./ui";

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

afterEach(() => {
  vi.useRealTimers();
});

const NOTES = "내일 회의를 30분 미룹니다";
const OUTPUT = "제목: 회의 시간 변경 안내\n\n내일 회의를 30분 늦춥니다.";

type Opened = Awaited<ReturnType<typeof openHome>>;

async function generateOnce(user: Opened["user"], notes = NOTES, output = OUTPUT) {
  h.claude.script(reply(output));
  await write(user, notes);
  await submit(user);
  await waitFor(() => expect(resultText()).toBe(output));
  await sidebar().findByRole("button", { name: new RegExp(notes) });
  await waitFor(() => expect(screen.getByRole("button", { name: "더 짧게" })).toBeEnabled());
}

const savedHistory = () => h.readJson<HistoryItem[]>("history.json");
const patches = () => h.requests.filter((r) => r.method === "PATCH");

describe("결과 직접 편집", () => {
  test("고친 글은 1초 뒤 history.json에 저장되고 저장됨이 보이며 새로 열어도 고친 글이다", async () => {
    const first = await openHome();
    await generateOnce(first.user);
    fakeSaveTimers();
    await first.user.type(resultBox(), "\n추신: 감사합니다.");

    await advance(999);
    expect(patches()).toHaveLength(0);
    expect((await savedHistory())[0].output).toBe(OUTPUT);
    await advance(1);
    expect(patches()).toHaveLength(1);
    realSaveTimers();
    expect(await screen.findByText("저장됨")).toBeInTheDocument();
    const [saved] = await savedHistory();
    expect(saved.output).toBe(`${OUTPUT}\n추신: 감사합니다.`);
    expect(saved.input).toBe(NOTES);
    first.unmount();

    const { user } = await openHome();
    await user.click(await sidebar().findByRole("button", { name: new RegExp(NOTES) }));
    expect(resultText()).toBe(`${OUTPUT}\n추신: 감사합니다.`);
  });

  test("고친 글로 다듬기를 요청하고, 기록 파일은 고친 글 저장 뒤에 다듬은 결과로 끝난다", async () => {
    const { user } = await openHome();
    await generateOnce(user);
    fakeSaveTimers();
    await user.type(resultBox(), " (고침)");
    realSaveTimers();

    h.claude.script(reply("다듬은 글"));
    await user.click(screen.getByRole("button", { name: "더 짧게" }));
    await waitFor(() => expect(resultText()).toBe("다듬은 글"));

    const { stdin } = h.claude.runs[1];
    expect(stdin).toContain(`${OUTPUT} (고침)`);
    expect(stdin.indexOf(`${OUTPUT} (고침)`)).toBeLessThan(stdin.indexOf("더 짧게"));

    await waitFor(() => expect(patches()).toHaveLength(2));
    await waitFor(async () => expect((await savedHistory())[0].output).toBe("다듬은 글"));
    expect(await savedHistory()).toHaveLength(1);
  });

  test("고치고 1초 안에 다른 기록을 열면 앞 기록에 고친 글이 저장되고 열린 기록은 그대로다", async () => {
    const { user } = await openHome();
    await generateOnce(user, "첫 메모", "첫 글");
    await generateOnce(user, "둘째 메모", "둘째 글");
    expect((await savedHistory()).map((i) => i.input)).toEqual(["둘째 메모", "첫 메모"]);

    fakeSaveTimers();
    await user.type(resultBox(), " 고침");
    await user.click(sidebar().getByRole("button", { name: /첫 메모/ }));
    expect(resultText()).toBe("첫 글");
    expect(patches()).toHaveLength(1);
    await advance(2000);
    expect(patches()).toHaveLength(1);
    realSaveTimers();

    await waitFor(async () => {
      const saved = await savedHistory();
      expect(saved.find((i) => i.input === "둘째 메모")?.output).toBe("둘째 글 고침");
    });
    const saved = await savedHistory();
    expect(saved.find((i) => i.input === "첫 메모")?.output).toBe("첫 글");
    expect(saved).toHaveLength(2);
  });

  test("고치고 1초 안에 새로 작성하면 앞 기록에 고친 글이 남고 새 기록이 따로 생긴다", async () => {
    const { user } = await openHome();
    await generateOnce(user, "첫 메모", "첫 글");
    fakeSaveTimers();
    await user.type(resultBox(), " 고침");
    realSaveTimers();
    await generateOnce(user, "둘째 메모", "둘째 글");

    await waitFor(async () => {
      const saved = await savedHistory();
      expect(saved.map((i) => [i.input, i.output])).toEqual([
        ["둘째 메모", "둘째 글"],
        ["첫 메모", "첫 글 고침"],
      ]);
    });
  });

  test("고친 뒤 열린 기록을 지우면 지운 기록이 되살아나지 않는다", async () => {
    const { user } = await openHome();
    await generateOnce(user);
    fakeSaveTimers();
    await user.type(resultBox(), " 고침");
    await user.click(within(screen.getByRole("complementary")).getByRole("button", { name: "기록 삭제" }));
    realSaveTimers();
    await waitFor(async () => expect(await savedHistory()).toEqual([]));
    expect(screen.getByText("아직 기록이 없습니다.")).toBeInTheDocument();
    fakeSaveTimers();
    await advance(5000);
    expect(patches()).toHaveLength(0);
    realSaveTimers();
    expect(await savedHistory()).toEqual([]);
    expect(screen.queryByText("저장하지 못했습니다.")).not.toBeInTheDocument();
  });

  test("공백뿐인 글로 고치면 저장하지 않는다", async () => {
    const { user } = await openHome();
    await generateOnce(user);
    fakeSaveTimers();
    await user.clear(resultBox());
    await advance(5000);
    expect(patches()).toHaveLength(0);
    realSaveTimers();
    expect((await savedHistory())[0].output).toBe(OUTPUT);
  });

  test("기다리는 저장이 있을 때 화면을 닫아도 고친 글이 기록에 남는다", async () => {
    const first = await openHome();
    await generateOnce(first.user);
    fakeSaveTimers();
    await first.user.type(resultBox(), " 고침");
    first.unmount();
    expect(patches()).toHaveLength(1);
    realSaveTimers();
    await waitFor(async () => expect((await savedHistory())[0].output).toBe(`${OUTPUT} 고침`));
  });
});
