import { promises as fsPromises } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  addFormat,
  addHistory,
  deleteFormat,
  deleteHistory,
  getSettings,
  HISTORY_LIMIT,
  listFormats,
  listHistory,
  restoreDefaultFormats,
  saveSettings,
  updateFormat,
  updateHistoryOutput,
} from "@/lib/store";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fw-store-"));
  process.env.DATA_DIR = dir;
});

afterEach(async () => {
  delete process.env.DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

const entry = {
  formatId: "mail",
  formatName: "메일",
  recipient: "상사",
  tone: "격식",
  input: "내용",
  output: "결과",
};

describe("formats", () => {
  test("파일이 없으면 기본 포맷 7개로 파일을 만든다", async () => {
    const formats = await listFormats();
    expect(formats.map((f) => f.name)).toEqual([
      "메일",
      "채팅",
      "보고",
      "Jira 코멘트",
      "MR 본문",
      "리뷰 답글",
      "주간 보고",
    ]);
    const saved = JSON.parse(await readFile(path.join(dir, "formats.json"), "utf8"));
    expect(saved).toHaveLength(7);
  });

  test("추가하면 id가 붙고 목록 끝에 들어간다", async () => {
    const added = await addFormat({ name: "주간보고", instruction: "표로 쓴다." });
    expect(added.id).toBeTruthy();
    const formats = await listFormats();
    expect(formats).toHaveLength(8);
    expect(formats[7]).toEqual(added);
  });

  test("수정하면 해당 항목만 바뀐다", async () => {
    const updated = await updateFormat("chat", {
      name: "메신저",
      instruction: "짧게 쓴다.",
      example: "넵 확인했습니다",
    });
    expect(updated).toEqual({
      id: "chat",
      name: "메신저",
      instruction: "짧게 쓴다.",
      example: "넵 확인했습니다",
    });
    const formats = await listFormats();
    expect(formats.map((f) => f.name).slice(0, 3)).toEqual(["메일", "메신저", "보고"]);
    expect(formats).toHaveLength(7);
  });

  test("없는 id를 수정하면 null을 돌려준다", async () => {
    expect(await updateFormat("nope", { name: "a", instruction: "b" })).toBeNull();
  });

  test("삭제하면 true, 없는 id는 false", async () => {
    expect(await deleteFormat("report")).toBe(true);
    expect(await deleteFormat("report")).toBe(false);
    expect((await listFormats()).map((f) => f.id)).toEqual(["mail", "chat", "jira", "mr", "review", "weekly"]);
  });
});

describe("history", () => {
  test("파일이 없으면 빈 목록이다", async () => {
    expect(await listHistory()).toEqual([]);
  });

  test("추가하면 id와 시각이 붙고 최신이 맨 앞이다", async () => {
    const first = await addHistory({ ...entry, input: "첫째" });
    const second = await addHistory({ ...entry, input: "둘째" });
    expect(first.id).not.toBe(second.id);
    expect(Number.isNaN(Date.parse(first.createdAt))).toBe(false);
    expect((await listHistory()).map((h) => h.input)).toEqual(["둘째", "첫째"]);
  });

  test("결과를 갱신한다", async () => {
    const item = await addHistory(entry);
    const updated = await updateHistoryOutput(item.id, "다듬은 결과");
    expect(updated?.output).toBe("다듬은 결과");
    expect((await listHistory())[0].output).toBe("다듬은 결과");
  });

  test("없는 id의 결과를 갱신하면 null이다", async () => {
    expect(await updateHistoryOutput("nope", "x")).toBeNull();
  });

  test("삭제하면 true, 없는 id는 false", async () => {
    const item = await addHistory(entry);
    expect(await deleteHistory(item.id)).toBe(true);
    expect(await deleteHistory(item.id)).toBe(false);
    expect(await listHistory()).toEqual([]);
  });

  test("한도를 넘으면 오래된 것부터 지운다", async () => {
    for (let i = 0; i < HISTORY_LIMIT + 2; i++) {
      await addHistory({ ...entry, input: `입력 ${i}` });
    }
    const history = await listHistory();
    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(history[0].input).toBe(`입력 ${HISTORY_LIMIT + 1}`);
    expect(history[HISTORY_LIMIT - 1].input).toBe("입력 2");
  });
});

describe("restoreDefaultFormats", () => {
  const OLD_THREE = ["mail", "chat", "report"];
  const ALL = ["mail", "chat", "report", "jira", "mr", "review", "weekly"];
  const writeFormats = (list: unknown) =>
    writeFile(path.join(dir, "formats.json"), JSON.stringify(list), "utf8");

  test("예전 기본 3개만 있는 파일에는 새 기본 포맷 4개를 끝에 붙인다", async () => {
    await listFormats();
    const saved = JSON.parse(await readFile(path.join(dir, "formats.json"), "utf8"));
    await writeFormats(saved.slice(0, 3));
    const { formats, added } = await restoreDefaultFormats();
    expect(added).toBe(4);
    expect(formats.map((f) => f.id)).toEqual(ALL);
    expect(JSON.parse(await readFile(path.join(dir, "formats.json"), "utf8"))).toEqual(formats);
  });

  test("사용자가 지운 기본 포맷은 목록 끝에 다시 붙는다", async () => {
    await listFormats();
    await deleteFormat("chat");
    const { formats, added } = await restoreDefaultFormats();
    expect(added).toBe(1);
    expect(formats.map((f) => f.id)).toEqual(ALL.filter((id) => id !== "chat").concat("chat"));
  });

  test("이미 있는 기본 포맷은 고친 내용 그대로 두고 다시 넣지 않는다", async () => {
    await listFormats();
    await updateFormat("mail", { name: "내 메일", instruction: "내가 고친 지시" });
    const { formats, added } = await restoreDefaultFormats();
    expect(added).toBe(0);
    expect(formats).toHaveLength(ALL.length);
    expect(formats.find((f) => f.id === "mail")).toEqual({
      id: "mail",
      name: "내 메일",
      instruction: "내가 고친 지시",
    });
  });

  test("이름이 같아도 id가 다르면 다른 포맷으로 보고 기본 포맷을 붙인다", async () => {
    await writeFormats([{ id: "mine", name: "Jira 코멘트", instruction: "내 지시" }]);
    const { formats, added } = await restoreDefaultFormats();
    expect(added).toBe(ALL.length);
    expect(formats.map((f) => f.id)).toEqual(["mine", ...ALL]);
  });

  test("추가할 것이 없으면 added가 0이고 파일을 바꾸지 않는다", async () => {
    await listFormats();
    const before = await readFile(path.join(dir, "formats.json"), "utf8");
    const { added } = await restoreDefaultFormats();
    expect(added).toBe(0);
    expect(await readFile(path.join(dir, "formats.json"), "utf8")).toBe(before);
  });

  test("파일이 없으면 기본 포맷 전체로 만들고 added는 0이다", async () => {
    const { formats, added } = await restoreDefaultFormats();
    expect(formats.map((f) => f.id)).toEqual(ALL);
    expect(added).toBe(0);
  });

  test("동시에 불러도 같은 기본 포맷이 두 번 들어가지 않는다", async () => {
    await writeFormats(OLD_THREE.map((id) => ({ id, name: id, instruction: id })));
    await Promise.all([restoreDefaultFormats(), restoreDefaultFormats()]);
    expect((await listFormats()).map((f) => f.id)).toEqual(ALL);
  });
});

describe("settings", () => {
  const settingsPath = () => path.join(dir, "settings.json");
  const brokenSettings = async () =>
    (await readdir(dir)).filter((n) => n.startsWith("settings.json.broken-"));

  test("파일이 없으면 빈 서명을 돌려주고 읽기만으로는 파일을 만들지 않는다", async () => {
    expect(await getSettings()).toEqual({ signature: "" });
    expect(await readdir(dir)).toEqual([]);
  });

  test("저장한 서명을 다시 읽을 수 있고 파일에 객체 하나로 남는다", async () => {
    await saveSettings({ signature: "홍길동\n개발팀" });
    expect(await getSettings()).toEqual({ signature: "홍길동\n개발팀" });
    expect(JSON.parse(await readFile(settingsPath(), "utf8"))).toEqual({ signature: "홍길동\n개발팀" });
  });

  test("다시 저장하면 덮어쓰고 임시 파일을 남기지 않는다", async () => {
    await saveSettings({ signature: "첫째" });
    await saveSettings({ signature: "" });
    expect(await getSettings()).toEqual({ signature: "" });
    expect((await readdir(dir)).filter((n) => n.includes(".tmp"))).toEqual([]);
  });

  test("동시에 저장해도 파일이 깨지지 않고 마지막 요청 값이 남는다", async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) => saveSettings({ signature: `서명 ${i}` })));
    expect(await getSettings()).toEqual({ signature: "서명 9" });
    expect(JSON.parse(await readFile(settingsPath(), "utf8"))).toEqual({ signature: "서명 9" });
  });

  test("settings.json이 올바른 JSON이 아니면 따로 치워 두고 기본값으로 다시 만든다", async () => {
    await writeFile(settingsPath(), "{ not json", "utf8");
    expect(await getSettings()).toEqual({ signature: "" });
    const broken = await brokenSettings();
    expect(broken).toHaveLength(1);
    expect(await readFile(path.join(dir, broken[0]), "utf8")).toBe("{ not json");
    expect(JSON.parse(await readFile(settingsPath(), "utf8"))).toEqual({ signature: "" });
  });

  test.each([["배열", "[1]"], ["null", "null"], ["문자열", '"서명"'], ["숫자", "3"]])(
    "settings.json이 객체가 아니면(%s) 따로 치워 두고 기본값으로 시작한다",
    async (_name, raw) => {
      await writeFile(settingsPath(), raw, "utf8");
      expect(await getSettings()).toEqual({ signature: "" });
      expect(await brokenSettings()).toHaveLength(1);
    },
  );

  test("signature가 문자열이 아니면 빈 서명으로 보고 파일은 그대로 둔다", async () => {
    await writeFile(settingsPath(), '{"signature": 3}', "utf8");
    expect(await getSettings()).toEqual({ signature: "" });
    expect(await brokenSettings()).toEqual([]);
    expect(await readFile(settingsPath(), "utf8")).toBe('{"signature": 3}');
  });

  test("목록 파일과 같은 줄에서 처리되어 읽기와 저장이 섞여도 온전한 값을 읽는다", async () => {
    const results = await Promise.all([
      saveSettings({ signature: "가나다" }),
      getSettings(),
      saveSettings({ signature: "라마바" }),
      getSettings(),
    ]);
    expect(results[1]).toEqual({ signature: "가나다" });
    expect(results[3]).toEqual({ signature: "라마바" });
  });
});

describe("동시 실행", () => {
  test("addHistory 20개를 동시에 불러도 모두 남는다", async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => addHistory({ ...entry, input: `입력 ${i}` })),
    );
    const history = await listHistory();
    expect(history).toHaveLength(20);
    expect(new Set(history.map((h) => h.input)).size).toBe(20);
  });

  test("빈 폴더에서 listFormats를 동시에 불러도 모두 기본 7개를 받는다", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => listFormats()));
    for (const formats of results) expect(formats).toHaveLength(7);
    expect(JSON.parse(await readFile(path.join(dir, "formats.json"), "utf8"))).toHaveLength(7);
  });

  test("쓰는 도중의 파일을 읽지 않도록 임시 파일을 거쳐 저장한다", async () => {
    await Promise.all([
      ...Array.from({ length: 10 }, (_, i) => addHistory({ ...entry, input: `입력 ${i}` })),
      ...Array.from({ length: 10 }, () => listHistory()),
    ]);
    expect(await listHistory()).toHaveLength(10);
    expect((await readdir(dir)).filter((n) => n.includes(".tmp"))).toEqual([]);
  });
});

describe("깨진 파일", () => {
  const brokenFiles = async () => (await readdir(dir)).filter((n) => n.includes(".broken-"));

  test("formats.json이 올바른 JSON이 아니면 따로 치워 두고 기본 포맷으로 다시 만든다", async () => {
    await writeFile(path.join(dir, "formats.json"), "{ not json", "utf8");
    const formats = await listFormats();
    expect(formats).toHaveLength(7);
    const broken = await brokenFiles();
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatch(/^formats\.json\.broken-/);
    expect(await readFile(path.join(dir, broken[0]), "utf8")).toBe("{ not json");
    expect(JSON.parse(await readFile(path.join(dir, "formats.json"), "utf8"))).toHaveLength(7);
  });

  test("history.json이 배열이 아니면 따로 치워 두고 빈 목록으로 시작한다", async () => {
    await writeFile(path.join(dir, "history.json"), '{"a":1}', "utf8");
    expect(await listHistory()).toEqual([]);
    expect(await brokenFiles()).toHaveLength(1);
    expect(JSON.parse(await readFile(path.join(dir, "history.json"), "utf8"))).toEqual([]);
    await addHistory(entry);
    expect(await listHistory()).toHaveLength(1);
  });

  test("깨진 history.json에 쓰기를 해도 실패하지 않는다", async () => {
    await writeFile(path.join(dir, "history.json"), "garbage", "utf8");
    await addHistory(entry);
    expect(await listHistory()).toHaveLength(1);
  });
});

describe("저장 실패", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("파일 교체가 실패하면 오류를 던지고 임시 파일을 남기지 않으며 기존 기록은 그대로다", async () => {
    await addHistory(entry);
    vi.spyOn(fsPromises, "rename").mockRejectedValueOnce(new Error("disk full"));
    await expect(addHistory({ ...entry, input: "실패할 입력" })).rejects.toThrow("disk full");
    expect((await readdir(dir)).filter((n) => n.includes(".tmp"))).toEqual([]);
    const list = await listHistory();
    expect(list).toHaveLength(1);
    expect(list[0].input).toBe("내용");
  });

  test("한 번 실패한 뒤에도 다음 저장은 정상 동작한다", async () => {
    await listHistory();
    vi.spyOn(fsPromises, "rename").mockRejectedValueOnce(new Error("disk full"));
    await expect(addHistory(entry)).rejects.toThrow("disk full");
    await addHistory({ ...entry, input: "두번째" });
    expect((await listHistory()).map((h) => h.input)).toEqual(["두번째"]);
  });
});
