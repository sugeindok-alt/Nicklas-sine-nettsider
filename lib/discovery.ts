export const platforms = [
  { id: "twitch", name: "Twitch", hosts: ["twitch.tv"], color: "#a970ff" },
  { id: "youtube", name: "YouTube", hosts: ["youtube.com"], color: "#ff555e" },
  { id: "instagram", name: "Instagram", hosts: ["instagram.com"], color: "#f074c0" },
  { id: "tiktok", name: "TikTok", hosts: ["tiktok.com"], color: "#53e1dd" },
  { id: "x", name: "X", hosts: ["x.com", "twitter.com"], color: "#343949" },
  { id: "kick", name: "Kick", hosts: ["kick.com"], color: "#83e65b" },
  { id: "facebook", name: "Facebook", hosts: ["facebook.com"], color: "#619cff" },
  { id: "reddit", name: "Reddit", hosts: ["reddit.com"], color: "#ff845d" },
  { id: "threads", name: "Threads", hosts: ["threads.net", "threads.com"], color: "#e1d9f0" },
  { id: "snapchat", name: "Snapchat", hosts: ["snapchat.com"], color: "#efdf63" },
  { id: "discord", name: "Discord", hosts: ["discord.gg", "discord.com"], color: "#8891ff" },
];
export type Hit = { title: string; url: string; description?: string };
export type Account = { platform: string; username: string; title: string; url: string; description: string; confidence: "Strong match" | "Possible match" | "Officially linked"; evidence: string };
export type Discovery = { query: string; accounts: Account[]; searchedAt: string; cached?: boolean; ambiguous: boolean };
const clean = (s: string) => s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&");
const normalize = (s: string) => s.toLowerCase().replace(/^@/, "").trim();
export function parseProfile(raw: string): { platform: string; username: string; url: string } | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
    const platform = platforms.find(p => p.hosts.includes(host));
    if (!platform) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    let username = "";
    const blocked = /^(search|explore|home|login|signup|settings|about|privacy|watch|reel|reels|p|stories|directory|videos|clip|clips|hashtag|share|intent|i|gaming|music|feed)$/i;
    if (platform.id === "youtube") {
      if (parts.length === 1 && parts[0].startsWith("@")) username = parts[0];
      else if (parts.length === 2 && /^(channel|c|user)$/.test(parts[0])) username = parts[1];
    } else if (platform.id === "reddit") {
      if (parts.length === 2 && /^(u|user)$/.test(parts[0])) username = parts[1];
    } else if (platform.id === "snapchat") {
      if (parts.length === 2 && parts[0] === "add") username = parts[1];
    } else if (platform.id === "discord") {
      if (host === "discord.gg" && parts.length === 1) username = parts[0];
      else if (parts.length === 2 && parts[0] === "invite") username = parts[1];
    } else if (parts.length === 1 && !blocked.test(parts[0])) username = parts[0];
    if (!username || !/^@?[\w.-]+$/.test(username)) return null;
    return { platform: platform.id, username: username.replace(/^@/, ""), url: `https://${host}/${parts.join("/")}` };
  } catch { return null; }
}
export function rankResults(query: string, hits: Hit[]): Account[] {
  const accounts = new Map<string, Account>();
  for (const hit of hits) {
    const parsed = parseProfile(hit.url);
    if (!parsed || accounts.has(parsed.url)) continue;
    const exact = normalize(parsed.username) === normalize(query);
    accounts.set(parsed.url, {
      ...parsed, title: clean(hit.title), description: clean(hit.description || ""),
      confidence: exact ? "Strong match" : "Possible match",
      evidence: exact ? "Exact username match in public search. Ownership is not independently verified." : "Publicly indexed result. Confirm this account belongs to the person you mean.",
    });
  }
  return [...accounts.values()].sort((a, b) => Number(b.confidence === "Strong match") - Number(a.confidence === "Strong match"));
}
export class SearchError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}
const cache = new Map<string, { expires: number; result: Discovery }>();
const inflight = new Map<string, Promise<Discovery>>();
export async function discover(query: string): Promise<Discovery> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) throw new SearchError("NOT_CONFIGURED", "Live discovery isn’t connected yet. The site owner needs to configure the search provider.", 503);
  const normalized = query.toLowerCase();
  const cached = cache.get(normalized);
  if (cached && cached.expires > Date.now()) return { ...cached.result, cached: true };
  if (inflight.has(normalized)) return inflight.get(normalized)!;
  const task = (async () => {
    const hits: Hit[] = [];
    for (const group of [platforms.slice(0, 5), platforms.slice(5)]) {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", `"${query.replace(/["\\]/g, "")}" (${group.flatMap(p => p.hosts.map(h => `site:${h}`)).join(" OR ")})`);
      url.searchParams.set("count", "20");
      let response: Response;
      try { response = await fetch(url, { headers: { "X-Subscription-Token": key, Accept: "application/json" }, signal: AbortSignal.timeout(12000), cache: "no-store" }); }
      catch { throw new SearchError("UNAVAILABLE", "The search service could not be reached. Please try again shortly.", 502); }
      if (!response.ok) throw new SearchError("PROVIDER_ERROR", response.status === 429 ? "The search provider is at its request limit. Please try again later." : "The search provider could not complete this request. Check the server’s API configuration.", response.status === 429 ? 429 : 502);
      const data = await response.json() as { web?: { results?: Hit[] } };
      for (const h of data.web?.results ?? []) if (typeof h.url === "string" && typeof h.title === "string") hits.push(h);
    }
    const accounts = rankResults(query, hits);
    const ambiguous = accounts.some(a => accounts.filter(b => b.platform === a.platform).length > 1);
    const result: Discovery = { query, accounts, searchedAt: new Date().toISOString(), ambiguous };
    const ttl = Math.min(3600, Math.max(0, Number(process.env.SEARCH_CACHE_TTL_SECONDS) || 0));
    if (ttl) {
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(normalized, { expires: Date.now() + ttl * 1000, result });
    }
    return result;
  })();
  inflight.set(normalized, task);
  try { return await task; } finally { inflight.delete(normalized); }
}

