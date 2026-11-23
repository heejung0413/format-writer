import { expect, test as base, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tempRoot } from "./env";

export type Invocation = {
  event: "invoke";
  pid: number;
  argv: string[];
  stdin: string;
  system: string;
  leakedEnvKeys: string[];
};
type LogEntry = Invocation | { event: "sigterm"; pid: number };

export type SavedHistory = {
  id: string;
  formatId: string;
  formatName: string;
  recipient: string;
  tone: string;
  input: string;
  output: string;
};
export type SavedFormat = { id: string; name: string; instruction: string; example?: string };

const root = tempRoot();
const dataDir = path.join(root, "data");
const logFile = path.join(root, "fake-claude.log");
const stateDir = path.join(root, "fake-state");

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(dataDir, name), "utf8")) as T;
}

/** 서버가 쓰는 임시 데이터 폴더와 가짜 claude의 기록을 시험 전에 처음 상태로 되돌린다. */
function resetState() {
  mkdirSync(dataDir, { recursive: true });
  for (const name of ["formats.json", "history.json", "settings.json"]) rmSync(path.join(dataDir, name), { force: true });
  rmSync(stateDir, { recursive: true, force: true });
  writeFileSync(logFile, "");
}

export class App {
  constructor(readonly page: Page) {}

  readonly notes = () => this.page.getByPlaceholder(/전하고 싶은 내용을/);
  readonly formatSelect = () => this.page.getByRole("combobox", { name: /^포맷/ });
  readonly recipientSelect = () => this.page.getByRole("combobox", { name: /^받는 사람/ });
  readonly toneSelect = () => this.page.getByRole("combobox", { name: /^말투/ });
  readonly generateButton = () => this.page.getByRole("button", { name: "작성하기" });
  readonly stopButton = () => this.page.getByRole("button", { name: "중단" });
  readonly copyButton = () => this.page.getByRole("button", { name: /^복사/ });
  readonly retryButton = () => this.page.getByRole("button", { name: "다시 시도" });
  readonly refineInput = () => this.page.getByPlaceholder(/수정 지시를 입력하세요/);
  readonly sidebar = () => this.page.getByRole("complementary");
  /** 결과 글. 역할이 없는 <pre>라서 태그로 찾는다. */
  readonly result = () => this.page.locator("pre");
  readonly emptyHistory = () => this.page.getByText("아직 기록이 없습니다.");
  readonly historyEntry = (text: string | RegExp) =>
    this.sidebar().getByRole("button", { name: text }).first();

  async open() {
    await this.page.goto("/");
    await expect(this.formatSelect().getByRole("option")).not.toHaveCount(0);
  }

  async write(text: string) {
    await this.notes().fill(text);
  }

  /** 글을 쓰고 작성하기를 누른다. 끝날 때까지 기다리지는 않는다. */
  async generate(text: string, options?: { format?: string; recipient?: string; tone?: string }) {
    if (options?.format) await this.formatSelect().selectOption({ label: options.format });
    if (options?.recipient) await this.recipientSelect().selectOption({ label: options.recipient });
    if (options?.tone) await this.toneSelect().selectOption({ label: options.tone });
    await this.write(text);
    await this.generateButton().click();
  }

  /** 작성이 끝나 입력 칸이 다시 열릴 때까지 기다린다. */
  async untilIdle() {
    await expect(this.generateButton()).toBeVisible();
    await expect(this.notes()).toBeEnabled();
  }

  async resultText(): Promise<string> {
    return (await this.result().textContent()) ?? "";
  }

  history(): SavedHistory[] {
    return readJson<SavedHistory[]>("history.json");
  }

  formats(): SavedFormat[] {
    return readJson<SavedFormat[]>("formats.json");
  }

  private logEntries(): LogEntry[] {
    if (!existsSync(logFile)) return [];
    return readFileSync(logFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LogEntry);
  }

  invocations(): Invocation[] {
    return this.logEntries().filter((e): e is Invocation => e.event === "invoke");
  }

  sigtermCount(): number {
    return this.logEntries().filter((e) => e.event === "sigterm").length;
  }
}

export const test = base.extend<{ app: App }>({
  app: async ({ page }, provide) => {
    resetState();
    await provide(new App(page));
  },
});

export { expect };
