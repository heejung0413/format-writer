import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("@/lib/claude", () => ({
  async *streamClaude() {
    yield { type: "text", text: "api" };
  },
}));
vi.mock("@/lib/claude-code", () => ({
  async *streamClaudeCode() {
    yield { type: "text", text: "claude-code" };
  },
}));

import { streamClaude } from "@/lib/provider";

const saved = process.env.CLAUDE_PROVIDER;
const args = { system: "s", messages: [{ role: "user" as const, content: "c" }] };

async function first() {
  for await (const line of streamClaude(args)) return line;
}

beforeEach(() => {
  delete process.env.CLAUDE_PROVIDER;
});

afterEach(() => {
  if (saved === undefined) delete process.env.CLAUDE_PROVIDER;
  else process.env.CLAUDE_PROVIDER = saved;
});

test("기본은 로그인된 Claude Code를 쓴다", async () => {
  expect(await first()).toEqual({ type: "text", text: "claude-code" });
});

test("CLAUDE_PROVIDER=api면 API 키로 호출한다", async () => {
  process.env.CLAUDE_PROVIDER = "api";
  expect(await first()).toEqual({ type: "text", text: "api" });
});
