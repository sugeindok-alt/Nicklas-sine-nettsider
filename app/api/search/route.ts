import { discover, SearchError } from "@/lib/discovery";
export const runtime = "nodejs";
const requests = new Map<string, { count: number; reset: number }>();
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim().replace(/^@/, "") || "";
  if (query.length < 2 || query.length > 80 || /[\x00-\x1f]/.test(query)) return Response.json({ error: "Enter a name or username between 2 and 80 characters." }, { status: 400 });
  const id = "global";
  const now = Date.now();
  let limit = requests.get(id);
  if (!limit || limit.reset < now) { limit = { count: 0, reset: now + 60000 }; requests.set(id, limit); }
  if (++limit.count > 30) return Response.json({ error: "Too many searches. Please wait a minute." }, { status: 429, headers: { "Retry-After": "60" } });
  try { return Response.json(await discover(query), { headers: { "Cache-Control": "no-store" } }); }
  catch (e) {
    return Response.json({ error: e instanceof SearchError ? e.message : "Discovery is temporarily unavailable.", code: e instanceof SearchError ? e.code : "UNAVAILABLE" }, { status: e instanceof SearchError ? e.status : 500, headers: { "Cache-Control": "no-store", ...(e instanceof SearchError && e.retryAfter ? { "Retry-After": String(e.retryAfter) } : {}) } });
  }
}
