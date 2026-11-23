import { requireJsonType } from "@/lib/request";
import { restoreDefaultFormats } from "@/lib/store";

export async function POST(req: Request) {
  const rejected = requireJsonType(req);
  if (rejected) return rejected;
  return Response.json(await restoreDefaultFormats());
}
