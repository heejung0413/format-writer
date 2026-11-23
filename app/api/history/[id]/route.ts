import { deleteHistory, updateHistoryOutput } from "@/lib/store";

type Context = { params: Promise<{ id: string }> };

const notFound = () =>
  Response.json(
    { error: { code: "not_found", message: "기록을 찾을 수 없습니다." } },
    { status: 404 },
  );

export async function PATCH(req: Request, { params }: Context) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.output !== "string") {
    return Response.json(
      { error: { code: "bad_request", message: "결과가 없습니다." } },
      { status: 400 },
    );
  }
  const updated = await updateHistoryOutput(id, body.output);
  return updated ? Response.json(updated) : notFound();
}

export async function DELETE(_req: Request, { params }: Context) {
  const { id } = await params;
  return (await deleteHistory(id)) ? new Response(null, { status: 204 }) : notFound();
}
