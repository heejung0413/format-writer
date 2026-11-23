import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DEFAULT_FORMATS } from "./defaults";
import type { Format, HistoryItem, Settings } from "./types";

export const HISTORY_LIMIT = 200;

const FORMATS_FILE = "formats.json";
const HISTORY_FILE = "history.json";
const SETTINGS_FILE = "settings.json";

function dataDir(): string {
  return process.env.DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
}

function filePath(name: string): string {
  return path.join(/*turbopackIgnore: true*/ dataDir(), name);
}

// 모든 저장소 작업(읽기 포함)을 한 줄로 세워 한 번에 하나씩만 실행한다.
let queue: Promise<unknown> = Promise.resolve();

function serial<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task);
  queue = result.catch(() => undefined);
  return result;
}

async function writeFileAtomic(name: string, value: unknown): Promise<void> {
  await fs.mkdir(/*turbopackIgnore: true*/ dataDir(), { recursive: true });
  const target = filePath(name);
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2), "utf8");
    await fs.rename(temp, target);
  } catch (err) {
    await fs.rm(temp, { force: true });
    throw err;
  }
}

async function setAside(name: string): Promise<void> {
  const target = filePath(name);
  await fs.rename(target, `${target}.broken-${Date.now()}`);
}

const writeList = <T>(name: string, list: T[]) => writeFileAtomic(name, list);

type Read = { status: "missing" } | { status: "ok"; value: unknown } | { status: "broken" };

async function readParsed(name: string, accept: (value: unknown) => boolean): Promise<Read> {
  let text: string;
  try {
    text = await fs.readFile(filePath(name), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return { status: "missing" };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (accept(parsed)) return { status: "ok", value: parsed };
  } catch {
    // 아래에서 깨진 파일로 처리한다.
  }
  return { status: "broken" };
}

async function readList<T>(name: string, fallback: T[]): Promise<T[]> {
  const read = await readParsed(name, Array.isArray);
  if (read.status === "ok") return read.value as T[];
  if (read.status === "broken") await setAside(name);
  await writeList(name, fallback);
  return [...fallback];
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function readSettings(): Promise<Settings> {
  const read = await readParsed(SETTINGS_FILE, isPlainObject);
  if (read.status === "broken") {
    await setAside(SETTINGS_FILE);
    await writeFileAtomic(SETTINGS_FILE, DEFAULT_SETTINGS);
  }
  if (read.status !== "ok") return { ...DEFAULT_SETTINGS };
  const { signature } = read.value as Record<string, unknown>;
  return { signature: typeof signature === "string" ? signature : "" };
}

const DEFAULT_SETTINGS: Settings = { signature: "" };

export type FormatInput = { name: string; instruction: string; example?: string };

const readFormats = () => readList<Format>(FORMATS_FILE, DEFAULT_FORMATS);
const readHistory = () => readList<HistoryItem>(HISTORY_FILE, []);

export function listFormats(): Promise<Format[]> {
  return serial(readFormats);
}

/** 목록에 없는 id의 기본 포맷만 끝에 붙인다. 이미 있는 포맷은 고친 내용 그대로 둔다. */
export function restoreDefaultFormats(): Promise<{ formats: Format[]; added: number }> {
  return serial(async () => {
    const formats = await readFormats();
    const known = new Set(formats.map((f) => f.id));
    const missing = DEFAULT_FORMATS.filter((f) => !known.has(f.id));
    if (missing.length === 0) return { formats, added: 0 };
    const next = [...formats, ...missing];
    await writeList(FORMATS_FILE, next);
    return { formats: next, added: missing.length };
  });
}

export function addFormat(input: FormatInput): Promise<Format> {
  return serial(async () => {
    const formats = await readFormats();
    const format: Format = { id: randomUUID(), ...input };
    await writeList(FORMATS_FILE, [...formats, format]);
    return format;
  });
}

export function updateFormat(id: string, input: FormatInput): Promise<Format | null> {
  return serial(async () => {
    const formats = await readFormats();
    if (!formats.some((f) => f.id === id)) return null;
    const updated: Format = { id, ...input };
    await writeList(
      FORMATS_FILE,
      formats.map((f) => (f.id === id ? updated : f)),
    );
    return updated;
  });
}

export function deleteFormat(id: string): Promise<boolean> {
  return serial(async () => {
    const formats = await readFormats();
    const rest = formats.filter((f) => f.id !== id);
    if (rest.length === formats.length) return false;
    await writeList(FORMATS_FILE, rest);
    return true;
  });
}

export function getSettings(): Promise<Settings> {
  return serial(readSettings);
}

export function saveSettings(settings: Settings): Promise<Settings> {
  return serial(async () => {
    const saved: Settings = { signature: settings.signature };
    await writeFileAtomic(SETTINGS_FILE, saved);
    return saved;
  });
}

export type HistoryInput = Omit<HistoryItem, "id" | "createdAt">;

export function listHistory(): Promise<HistoryItem[]> {
  return serial(readHistory);
}

export function addHistory(input: HistoryInput): Promise<HistoryItem> {
  return serial(async () => {
    const history = await readHistory();
    const item: HistoryItem = { id: randomUUID(), createdAt: new Date().toISOString(), ...input };
    await writeList(HISTORY_FILE, [item, ...history].slice(0, HISTORY_LIMIT));
    return item;
  });
}

export function updateHistoryOutput(id: string, output: string): Promise<HistoryItem | null> {
  return serial(async () => {
    const history = await readHistory();
    const target = history.find((h) => h.id === id);
    if (!target) return null;
    const updated = { ...target, output };
    await writeList(
      HISTORY_FILE,
      history.map((h) => (h.id === id ? updated : h)),
    );
    return updated;
  });
}

export function deleteHistory(id: string): Promise<boolean> {
  return serial(async () => {
    const history = await readHistory();
    const rest = history.filter((h) => h.id !== id);
    if (rest.length === history.length) return false;
    await writeList(HISTORY_FILE, rest);
    return true;
  });
}
