import { connection } from "next/server";
import { readJsonBody } from "@/lib/request";
import { addHistory, listHistory, type HistoryInput } from "@/lib/store";

const FIELDS = ["formatId", "formatName", "recipient", "tone", "input", "output"] as const;

export async function GET() {
  await connection();
  return Response.json(await listHistory());
}

export async function POST(req: Request) {
  const body = await readJsonBody(req);
  if (body instanceof Response) return body;
  if (!body || FIELDS.some((key) => typeof body[key] !== "string")) {
    return Response.json(
      { error: { code: "bad_request", message: "기록 형식이 올바르지 않습니다." } },
      { status: 400 },
    );
  }
  const input = Object.fromEntries(FIELDS.map((key) => [key, body[key]])) as HistoryInput;
  if (typeof body.length === "string") input.length = body.length;
  return Response.json(await addHistory(input), { status: 201 });
}
