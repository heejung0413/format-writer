// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { Format, HistoryItem } from "@/lib/types";
import { setupHarness } from "./harness";
import { reply } from "./fake-claude";
import { choose, formatNames, openHome, resultText, sidebar, submit, write, type User } from "./ui";

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

const MAIL_INSTRUCTION = "첫 줄에 '제목: ...'을 쓴다.";
const CHAT_INSTRUCTION = "업무 메신저에 바로 보낼 수 있는 짧은 글로 쓴다.";

async function openManager(user: User) {
  await user.click(screen.getByRole("button", { name: "포맷 관리" }));
  await screen.findByRole("heading", { name: "포맷 관리" });
}

const closeManager = (user: User) => user.click(screen.getByRole("button", { name: "닫기" }));

const managerRow = (name: string) => {
  const li = screen.getByText(name, { selector: "span" }).closest("li");
  if (!li) throw new Error(`포맷 관리 목록에 ${name} 줄이 없습니다.`);
  return within(li);
};

async function generate(user: User, notes: string, output = "만들어진 글") {
  h.claude.script(reply(output));
  await write(user, notes);
  await submit(user);
  await waitFor(() => expect(resultText()).toBe(output));
  await sidebar().findByRole("button", { name: new RegExp(notes) });
}

describe("나만의 포맷", () => {
  test("추가한 포맷이 formats.json과 목록에 들어가고 그 지시문과 예시로 글을 쓴다", async () => {
    const { user } = await openHome();
    await openManager(user);
    await user.type(screen.getByPlaceholderText(/이름 \(예: 주간보고\)/), "주간보고");
    await user.type(screen.getByPlaceholderText(/지시문:/), "표로 정리하고 마지막에 다음 주 계획을 쓴다.");
    await user.type(screen.getByPlaceholderText(/예시 글/), "이번 주 요약\n- 완료: 로그인");
    await user.click(screen.getByRole("button", { name: "추가" }));

    await waitFor(() => expect(formatNames()).toEqual(["메일", "채팅", "보고", "주간보고"]));
    const saved = await h.readJson<Format[]>("formats.json");
    expect(saved).toHaveLength(4);
    expect(saved[3]).toMatchObject({
      name: "주간보고",
      instruction: "표로 정리하고 마지막에 다음 주 계획을 쓴다.",
      example: "이번 주 요약\n- 완료: 로그인",
    });
    expect(saved[3].id).toBeTruthy();

    await closeManager(user);
    await choose(user, "포맷", "주간보고");
    await generate(user, "이번 주 한 일");

    const { system } = h.claude.runs[0];
    expect(system).toContain("포맷: 주간보고");
    expect(system).toContain("포맷 지시: 표로 정리하고 마지막에 다음 주 계획을 쓴다.");
    expect(system).toContain("<예시>\n이번 주 요약\n- 완료: 로그인\n</예시>");
    const [item] = await h.readJson<HistoryItem[]>("history.json");
    expect(item).toMatchObject({ formatId: saved[3].id, formatName: "주간보고" });
  });

  test("포맷을 수정하면 formats.json과 목록이 바뀌고 새 지시문으로 글을 쓴다", async () => {
    const { user } = await openHome();
    await openManager(user);
    await user.click(managerRow("채팅").getByRole("button", { name: "수정" }));
    const name = screen.getByPlaceholderText(/이름 \(예/);
    const instruction = screen.getByPlaceholderText(/지시문:/);
    await user.clear(name);
    await user.type(name, "메신저");
    await user.clear(instruction);
    await user.type(instruction, "두 문장으로만 쓴다.");
    await user.click(screen.getByRole("button", { name: "수정 저장" }));

    await waitFor(() => expect(formatNames()).toEqual(["메일", "메신저", "보고"]));
    const saved = await h.readJson<Format[]>("formats.json");
    expect(saved.map((f) => f.id)).toEqual(["mail", "chat", "report"]);
    expect(saved[1]).toMatchObject({ id: "chat", name: "메신저", instruction: "두 문장으로만 쓴다." });
    expect(saved[0].name).toBe("메일");

    await closeManager(user);
    await choose(user, "포맷", "메신저");
    await generate(user, "점심 어디서 먹을까");
    expect(h.claude.runs[0].system).toContain("포맷 지시: 두 문장으로만 쓴다.");
    expect(h.claude.runs[0].system).not.toContain(CHAT_INSTRUCTION);
  });

  test("선택된 포맷을 지우면 남은 첫 포맷으로 다음 글을 쓴다", async () => {
    const { user } = await openHome();
    expect(screen.getByLabelText("포맷")).toHaveValue("mail");
    await openManager(user);
    await user.click(managerRow("메일").getByRole("button", { name: "삭제" }));

    await waitFor(() => expect(formatNames()).toEqual(["채팅", "보고"]));
    expect((await h.readJson<Format[]>("formats.json")).map((f) => f.id)).toEqual(["chat", "report"]);
    expect(screen.getByLabelText("포맷")).toHaveValue("chat");

    await closeManager(user);
    await generate(user, "점심 어디서 먹을까");
    const { system } = h.claude.runs[0];
    expect(system).toContain("포맷: 채팅");
    expect(system).toContain(CHAT_INSTRUCTION);
    expect(system).not.toContain(MAIL_INSTRUCTION);
    const [item] = await h.readJson<HistoryItem[]>("history.json");
    expect(item).toMatchObject({ formatId: "chat", formatName: "채팅" });
  });
});

describe("깨진 데이터 파일", () => {
  test("formats.json이 깨져 있어도 기본 포맷 3개로 시작하고 깨진 파일은 따로 보관한다", async () => {
    await h.writeRaw("formats.json", "{ 깨진 json");
    const { user } = await openHome();

    expect(formatNames()).toEqual(["메일", "채팅", "보고"]);
    const files = await h.files();
    const broken = files.filter((f) => f.startsWith("formats.json.broken-"));
    expect(broken).toHaveLength(1);
    expect((await h.readJson<Format[]>("formats.json")).map((f) => f.id)).toEqual([
      "mail",
      "chat",
      "report",
    ]);

    await generate(user, "내일 회의를 미룹니다");
    expect(h.claude.runs[0].stdin).toBe("내일 회의를 미룹니다");
    expect(await h.readJson<HistoryItem[]>("history.json")).toHaveLength(1);
  });
});
