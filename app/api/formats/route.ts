import { connection } from "next/server";
import { parseFormatInput } from "@/lib/format-input";
import { readJsonBody } from "@/lib/request";
import { addFormat, listFormats } from "@/lib/store";

export async function GET() {
  await connection();
  return Response.json(await listFormats());
}

export async function POST(req: Request) {
  const body = await readJsonBody(req);
  if (body instanceof Response) return body;
  const input = parseFormatInput(body);
  if (!input) {
    return Response.json(
      { error: { code: "bad_request", message: "이름과 지시문을 입력해 주세요." } },
      { status: 400 },
    );
  }
  return Response.json(await addFormat(input), { status: 201 });
}
