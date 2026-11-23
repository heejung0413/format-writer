export type JsonBody = Record<string, unknown>;

export function unsupportedMediaType(): Response {
  return Response.json(
    { error: { code: "unsupported_media_type", message: "JSON 요청만 받습니다." } },
    { status: 415 },
  );
}

/**
 * JSON 요청 본문을 읽는다. Content-Type이 application/json이 아니면 415 Response를,
 * JSON이 아니거나 객체가 아니면 null을 돌려준다.
 * text/plain 같은 "단순 요청"은 브라우저가 사전 확인(preflight) 없이 보내므로,
 * 다른 사이트의 페이지가 localhost로 몰래 보내는 요청을 여기서 막는다.
 */
export async function readJsonBody(req: Request): Promise<JsonBody | null | Response> {
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return unsupportedMediaType();
  const parsed: unknown = await req.json().catch(() => null);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  return parsed as JsonBody;
}
