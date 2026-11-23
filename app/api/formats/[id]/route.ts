import { parseFormatInput } from "@/lib/format-input";
import { deleteFormat, updateFormat } from "@/lib/store";

type Context = { params: Promise<{ id: string }> };

const notFound = () =>
  Response.json(
    { error: { code: "not_found", message: "포맷을 찾을 수 없습니다." } },
    { status: 404 },
  );

export async function PUT(req: Request, { params }: Context) {
  const { id } = await params;
  const input = parseFormatInput(await req.json().catch(() => null));
  if (!input) {
    return Response.json(
      { error: { code: "bad_request", message: "이름과 지시문을 입력해 주세요." } },
      { status: 400 },
    );
  }
  const updated = await updateFormat(id, input);
  return updated ? Response.json(updated) : notFound();
}

export async function DELETE(_req: Request, { params }: Context) {
  const { id } = await params;
  return (await deleteFormat(id)) ? new Response(null, { status: 204 }) : notFound();
}
