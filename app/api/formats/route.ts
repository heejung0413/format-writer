import { connection } from "next/server";
import { parseFormatInput } from "@/lib/format-input";
import { addFormat, listFormats } from "@/lib/store";

export async function GET() {
  await connection();
  return Response.json(await listFormats());
}

export async function POST(req: Request) {
  const input = parseFormatInput(await req.json().catch(() => null));
  if (!input) {
    return Response.json(
      { error: { code: "bad_request", message: "이름과 지시문을 입력해 주세요." } },
      { status: 400 },
    );
  }
  return Response.json(await addFormat(input), { status: 201 });
}
