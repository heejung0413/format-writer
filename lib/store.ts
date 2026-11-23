import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DEFAULT_FORMATS } from "./defaults";
import type { Format, HistoryItem } from "./types";

export const HISTORY_LIMIT = 200;

const FORMATS_FILE = "formats.json";
const HISTORY_FILE = "history.json";

function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

async function writeList<T>(name: string, list: T[]): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(path.join(dataDir(), name), JSON.stringify(list, null, 2), "utf8");
}

async function readList<T>(name: string, fallback: T[]): Promise<T[]> {
  try {
    return JSON.parse(await fs.readFile(path.join(dataDir(), name), "utf8")) as T[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    await writeList(name, fallback);
    return [...fallback];
  }
}

export type FormatInput = { name: string; instruction: string; example?: string };

export function listFormats(): Promise<Format[]> {
  return readList<Format>(FORMATS_FILE, DEFAULT_FORMATS);
}

export async function addFormat(input: FormatInput): Promise<Format> {
  const formats = await listFormats();
  const format: Format = { id: randomUUID(), ...input };
  await writeList(FORMATS_FILE, [...formats, format]);
  return format;
}

export async function updateFormat(id: string, input: FormatInput): Promise<Format | null> {
  const formats = await listFormats();
  if (!formats.some((f) => f.id === id)) return null;
  const updated: Format = { id, ...input };
  await writeList(
    FORMATS_FILE,
    formats.map((f) => (f.id === id ? updated : f)),
  );
  return updated;
}

export async function deleteFormat(id: string): Promise<boolean> {
  const formats = await listFormats();
  const rest = formats.filter((f) => f.id !== id);
  if (rest.length === formats.length) return false;
  await writeList(FORMATS_FILE, rest);
  return true;
}

export type HistoryInput = Omit<HistoryItem, "id" | "createdAt">;

export function listHistory(): Promise<HistoryItem[]> {
  return readList<HistoryItem>(HISTORY_FILE, []);
}

export async function addHistory(input: HistoryInput): Promise<HistoryItem> {
  const history = await listHistory();
  const item: HistoryItem = { id: randomUUID(), createdAt: new Date().toISOString(), ...input };
  await writeList(HISTORY_FILE, [item, ...history].slice(0, HISTORY_LIMIT));
  return item;
}

export async function updateHistoryOutput(id: string, output: string): Promise<HistoryItem | null> {
  const history = await listHistory();
  const target = history.find((h) => h.id === id);
  if (!target) return null;
  const updated = { ...target, output };
  await writeList(
    HISTORY_FILE,
    history.map((h) => (h.id === id ? updated : h)),
  );
  return updated;
}

export async function deleteHistory(id: string): Promise<boolean> {
  const history = await listHistory();
  const rest = history.filter((h) => h.id !== id);
  if (rest.length === history.length) return false;
  await writeList(HISTORY_FILE, rest);
  return true;
}
