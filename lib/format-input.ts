import type { FormatInput } from "./store";

export function parseFormatInput(body: unknown): FormatInput | null {
  const data = body as { name?: unknown; instruction?: unknown; example?: unknown } | null;
  const name = typeof data?.name === "string" ? data.name.trim() : "";
  const instruction = typeof data?.instruction === "string" ? data.instruction.trim() : "";
  if (!name || !instruction) return null;
  const example = typeof data?.example === "string" ? data.example.trim() : "";
  return example ? { name, instruction, example } : { name, instruction };
}
