// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { setupHarness } from "./harness";
import { reply } from "./fake-claude";
import { choose, openHome, resultText, submit, write, type User } from "./ui";

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
const SIGNATURE = "홍길동\n개발팀 · 010-0000-0000";

async function openSettings(user: User) {
  await user.click(screen.getByRole("button", { name: "설정" }));
  const box = await screen.findByLabelText("서명");
  await waitFor(() => expect(box).toBeEnabled());
  return box;
}

async function saveSignature(user: User, signature: string) {
  const box = await openSettings(user);
  await user.clear(box);
  if (signature) await user.type(box, signature.replaceAll("\n", "{Enter}"));
  await user.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "설정" })).not.toBeInTheDocument());
}

async function generateOnce(user: User, output = "만들어진 글") {
  h.claude.script(reply(output));
  await write(user, NOTES);
  await submit(user);
  await waitFor(() => expect(resultText()).toBe(output));
}

describe("서명 저장", () => {
  test("저장한 서명이 settings.json에 남고 메일 지시문에 들어가지만 입력(stdin)에는 없다", async () => {
    const { user } = await openHome();
    await saveSignature(user, `  ${SIGNATURE}  `);
    expect(await h.readJson("settings.json")).toEqual({ signature: SIGNATURE });

    await choose(user, "포맷", "메일");
    await generateOnce(user);
    const [run] = h.claude.runs;
    expect(run.system).toContain(`<서명>\n${SIGNATURE}\n</서명>`);
    expect(run.system).toContain("서명이 어울리지 않는 글");
    expect(run.stdin).toBe(NOTES);
  });

  test("브라우저는 생성 요청과 기록 저장 요청에 서명을 싣지 않는다", async () => {
    const { user } = await openHome();
    await saveSignature(user, SIGNATURE);

    const sent: { path: string; body: string }[] = [];
    const routed = fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ path: String(input), body: String(init?.body ?? "") });
      return routed(input, init);
    });
    await generateOnce(user);
    await waitFor(() => expect(sent.some((r) => r.path === "/api/history")).toBe(true));

    expect(sent.map((r) => r.path)).toEqual(expect.arrayContaining(["/api/generate", "/api/history"]));
    for (const request of sent) {
      expect(request.body).not.toContain("개발팀");
      expect(request.body).not.toContain("signature");
    }
    expect(h.claude.runs[0].system).toContain("개발팀");
  });

  test("새로 열어도 설정 모달에 저장된 서명이 채워진다", async () => {
    const first = await openHome();
    await saveSignature(first.user, SIGNATURE);
    first.unmount();

    const { user } = await openHome();
    expect(await openSettings(user)).toHaveValue(SIGNATURE);
  });

  test("서명을 지우면 다음 글부터 지시문에 서명이 없다", async () => {
    const { user } = await openHome();
    await saveSignature(user, SIGNATURE);
    await generateOnce(user, "첫 글");
    await saveSignature(user, "");
    expect(await h.readJson("settings.json")).toEqual({ signature: "" });
    await generateOnce(user, "둘째 글");

    expect(h.claude.runs[0].system).toContain("<서명>");
    expect(h.claude.runs[1].system).not.toContain("서명");
  });

  test("다듬기 요청에도 서명이 지시문에 들어간다", async () => {
    const { user } = await openHome();
    await saveSignature(user, SIGNATURE);
    await generateOnce(user, "첫 글");
    h.claude.script(reply("고친 글"));
    await user.click(await screen.findByRole("button", { name: "더 짧게" }));
    await waitFor(() => expect(resultText()).toBe("고친 글"));
    expect(h.claude.runs[1].system).toContain(`<서명>\n${SIGNATURE}\n</서명>`);
  });

  test("서명과 길이는 함께 지시문에 들어간다", async () => {
    const { user } = await openHome();
    await saveSignature(user, SIGNATURE);
    await choose(user, "길이", "짧게");
    await generateOnce(user);
    expect(h.claude.runs[0].system).toContain("길이: 짧게");
    expect(h.claude.runs[0].system).toContain("<서명>");
  });

  test("settings.json이 없어도 글을 쓸 수 있고 읽기만으로 파일이 생기지 않는다", async () => {
    const { user } = await openHome();
    await generateOnce(user);
    expect(h.claude.runs[0].system).not.toContain("서명");
    expect(await h.files()).not.toContain("settings.json");
  });

  test("settings.json이 깨져 있어도 글을 쓸 수 있고 깨진 파일은 따로 보관한다", async () => {
    await h.writeRaw("settings.json", "{ 깨진 json");
    const { user } = await openHome();
    await generateOnce(user);
    expect(h.claude.runs[0].system).not.toContain("서명");
    expect((await h.files()).filter((f) => f.startsWith("settings.json.broken-"))).toHaveLength(1);
    expect(await h.readJson("settings.json")).toEqual({ signature: "" });
  });
});
