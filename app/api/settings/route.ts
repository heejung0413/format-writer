import { connection } from "next/server";
import { readJsonBody } from "@/lib/request";
import { getSettings, saveSettings } from "@/lib/store";

const SIGNATURE_MAX = 500;

export async function GET() {
  await connection();
  return Response.json(await getSettings());
}

export async function PUT(req: Request) {
  const body = await readJsonBody(req);
  if (body instanceof Response) return body;
  const signature = typeof body?.signature === "string" ? body.signature.trim() : null;
  if (signature === null || signature.length > SIGNATURE_MAX) {
    return Response.json(
      {
        error: {
          code: "bad_request",
          message: `서명은 ${SIGNATURE_MAX}자 이하의 글로 입력해 주세요.`,
        },
      },
      { status: 400 },
    );
  }
  return Response.json(await saveSettings({ signature }));
}
