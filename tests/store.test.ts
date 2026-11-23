import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  addFormat,
  addHistory,
  deleteFormat,
  deleteHistory,
  HISTORY_LIMIT,
  listFormats,
  listHistory,
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
  test("파일이 없으면 기본 포맷 3개로 파일을 만든다", async () => {
    const formats = await listFormats();
    expect(formats.map((f) => f.name)).toEqual(["메일", "채팅", "보고"]);
    const saved = JSON.parse(await readFile(path.join(dir, "formats.json"), "utf8"));
    expect(saved).toHaveLength(3);
  });

  test("추가하면 id가 붙고 목록 끝에 들어간다", async () => {
    const added = await addFormat({ name: "주간보고", instruction: "표로 쓴다." });
    expect(added.id).toBeTruthy();
    const formats = await listFormats();
    expect(formats).toHaveLength(4);
    expect(formats[3]).toEqual(added);
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
    expect(formats.map((f) => f.name)).toEqual(["메일", "메신저", "보고"]);
  });

  test("없는 id를 수정하면 null을 돌려준다", async () => {
    expect(await updateFormat("nope", { name: "a", instruction: "b" })).toBeNull();
  });

  test("삭제하면 true, 없는 id는 false", async () => {
    expect(await deleteFormat("report")).toBe(true);
    expect(await deleteFormat("report")).toBe(false);
    expect((await listFormats()).map((f) => f.id)).toEqual(["mail", "chat"]);
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
