export type Format = {
  id: string;
  name: string;
  instruction: string;
  example?: string;
};

export type HistoryItem = {
  id: string;
  createdAt: string;
  formatId: string;
  formatName: string;
  recipient: string;
  tone: string;
  input: string;
  output: string;
};

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ErrorCode = "auth" | "rate_limit" | "refusal" | "api_error";

export type StreamLine =
  | { type: "text"; text: string }
  | { type: "done" }
  | { type: "error"; code: ErrorCode; message: string };
