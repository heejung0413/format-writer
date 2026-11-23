import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DEFAULT_FORMATS } from "./defaults";
import type { Format, HistoryItem } from "./types";

export const HISTORY_LIMIT = 200;

const FORMATS_FILE = "formats.json";
const HISTORY_FILE = "history.json";

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

async function writeList<T>(name: string, list: T[]): Promise<void> {
  await fs.mkdir(/*turbopackIgnore: true*/ dataDir(), { recursive: true });
  const target = filePath(name);
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(list, null, 2), "utf8");
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

async function readList<T>(name: string, fallback: T[]): Promise<T[]> {
  let text: string;
  try {
    text = await fs.readFile(filePath(name), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    await writeList(name, fallback);
    return [...fallback];
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed as T[];
  } catch {
    // 아래에서 깨진 파일로 처리한다.
  }
  await setAside(name);
  await writeList(name, fallback);
  return [...fallback];
}

export type FormatInput = { name: string; instruction: string; example?: string };

const readFormats = () => readList<Format>(FORMATS_FILE, DEFAULT_FORMATS);
const readHistory = () => readList<HistoryItem>(HISTORY_FILE, []);

export function listFormats(): Promise<Format[]> {
  return serial(readFormats);
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
