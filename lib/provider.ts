import { streamClaude as streamClaudeApi } from "./claude";
import { streamClaudeCode } from "./claude-code";
import type { ChatMessage, StreamLine } from "./types";

export function streamClaude(args: {
  system: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}): AsyncGenerator<StreamLine> {
  return process.env.CLAUDE_PROVIDER === "api" ? streamClaudeApi(args) : streamClaudeCode(args);
}
