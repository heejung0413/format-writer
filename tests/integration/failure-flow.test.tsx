// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { HistoryItem } from "@/lib/types";
import { setupHarness } from "./harness";
import { reply, replyWith, type Script } from "./fake-claude";
import { openHome, resultText, sidebar, submit, write } from "./ui";

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
const INCOMPLETE = "글이 끝까지 작성되지 않았습니다. 다시 시도해 주세요.";

const noHistory = async () => expect(await h.readJson("history.json")).toEqual([]);

describe("Claude 실패", () => {
  const cases: { name: string; script: Script; banner: string | RegExp }[] = [
    {
      name: "result가 is_error이면 그 사유를 보여 준다",
      script: (child) => {
        child.result({ is_error: true, subtype: "error_during_execution", result: "Credit balance is too low" });
        child.close(0);
      },
      banner: "Claude Code 요청에 실패했습니다: Credit balance is too low",
    },
    {
      name: "비정상 종료에 stderr만 있으면 stderr를 사유로 보여 준다",
      script: (child) => {
        child.err("Not logged in · Please run /login\n");
        child.close(1);
      },
      banner: "Claude Code 요청에 실패했습니다: Not logged in · Please run /login",
    },
    {
      name: "claude 실행 파일이 없으면 Claude Code 안내를 보여 준다",
      script: (child) => child.fail(Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" })),
      banner: /Claude Code를 찾을 수 없습니다/,
    },
    {
      name: "거절(refusal)이면 작성할 수 없다고 알린다",
      script: replyWith(["일부"], { stop_reason: "refusal" }),
      banner: "이 내용은 작성할 수 없습니다.",
    },
    {
      name: "max_tokens로 끊기면 끝까지 작성되지 않았다고 알린다",
      script: replyWith(["중간까지만"], { stop_reason: "max_tokens" }),
      banner: INCOMPLETE,
    },
    {
      name: "출력이 비어 있으면 끝까지 작성되지 않았다고 알린다",
      script: replyWith(["   "], {}),
      banner: INCOMPLETE,
    },
  ];

  test.each(cases)("$name", async ({ script, banner }) => {
    const { user } = await openHome();
    h.claude.script(script);
    await write(user, NOTES);
    await submit(user);

    expect(await screen.findByText(banner)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "작성하기" })).toBeEnabled();
    expect(sidebar().getByText("아직 기록이 없습니다.")).toBeInTheDocument();
    await noHistory();
    expect(h.requests.filter((r) => r.method === "POST" && r.path === "/api/history")).toEqual([]);
    expect(h.claude.runs).toHaveLength(1);
  });
});

describe("다시 시도와 중단", () => {
  test("실패 뒤 다시 시도하면 새 프로세스가 같은 내용으로 돌고 성공하면 기록이 하나 생긴다", async () => {
    const { user } = await openHome();
    h.claude.script(
      (child) => {
        child.err("일시적인 오류");
        child.close(1);
      },
      reply("두 번째에 성공한 글"),
    );
    await write(user, NOTES);
    await submit(user);
    await user.click(await screen.findByRole("button", { name: "다시 시도" }));

    await waitFor(() => expect(resultText()).toBe("두 번째에 성공한 글"));
    await sidebar().findByRole("button", { name: new RegExp(NOTES) });
    expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
    expect(h.claude.runs).toHaveLength(2);
    expect(h.claude.runs[1].child).not.toBe(h.claude.runs[0].child);
    expect(h.claude.runs[1].stdin).toBe(NOTES);

    const saved = await h.readJson<HistoryItem[]>("history.json");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ input: NOTES, output: "두 번째에 성공한 글" });
  });

  test("중단하면 claude 프로세스를 끝내고 나온 글은 화면에 남지만 기록은 생기지 않는다", async () => {
    const { user } = await openHome();
    h.claude.script(async (child) => {
      child.say("쓰다가 ");
      child.say("멈춘 글");
      await child.untilKilled();
    });
    await write(user, NOTES);
    await submit(user);
    await waitFor(() => expect(resultText()).toBe("쓰다가 멈춘 글"));

    await user.click(screen.getByRole("button", { name: "중단" }));

    await waitFor(() => expect(h.claude.runs[0].child.killed).toBe(true));
    expect(await screen.findByRole("button", { name: "작성하기" })).toBeEnabled();
    expect(resultText()).toBe("쓰다가 멈춘 글");
    expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
    await noHistory();
    expect(sidebar().getByText("아직 기록이 없습니다.")).toBeInTheDocument();
  });
});

describe("서버 검증 (화면과 같은 fetch 경로)", () => {
  const post = (body: string, type: string) =>
    fetch("/api/generate", { method: "POST", headers: { "Content-Type": type }, body });

  test("없는 포맷으로 생성을 요청하면 404와 JSON 오류를 돌려주고 프로세스를 띄우지 않는다", async () => {
    const res = await post(JSON.stringify({ input: "내용", formatId: "nope" }), "application/json");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "not_found", message: "포맷을 찾을 수 없습니다. 포맷을 다시 골라 주세요." },
    });
    expect(h.claude.runs).toHaveLength(0);
  });

  test("text/plain 요청은 415이고 프로세스를 띄우지 않는다", async () => {
    const res = await post(JSON.stringify({ input: "내용", formatId: "mail" }), "text/plain");
    expect(res.status).toBe(415);
    expect((await res.json()).error.code).toBe("unsupported_media_type");
    expect(h.claude.runs).toHaveLength(0);
  });

  test("앞뒤 공백이 붙은 내용은 다듬어서 Claude에 넘기고, 공백뿐이면 400이다", async () => {
    h.claude.script(reply("글"));
    const ok = await post(JSON.stringify({ input: "  내용  ", formatId: "mail" }), "application/json");
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('{"type":"text","text":"글"}\n{"type":"done"}\n');
    expect(h.claude.runs[0].stdin).toBe("내용");

    const blank = await post(JSON.stringify({ input: "   ", formatId: "mail" }), "application/json");
    expect(blank.status).toBe(400);
    expect(h.claude.runs).toHaveLength(1);
  });

  test("라우터에 없는 경로로 요청하면 조용히 넘어가지 않고 예외가 난다", () => {
    expect(() => fetch("/api/formts")).toThrow(/없는 요청/);
    expect(() => fetch("/api/formats", { method: "PATCH" })).toThrow(/없는 요청/);
  });
});
