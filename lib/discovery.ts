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
export type Account = { platform: string; username: string; title: string; url: string; description: string; confidence: "Strong match" | "Possible match" | "Wikidata record"; evidence: string; sourceUrl?: string };
export type Identity = { id: string; name: string; description: string; sourceUrl: string; accounts: Account[] };
export type Discovery = { query: string; accounts: Account[]; searchedAt: string; cached?: boolean; ambiguous: boolean; provider: "wikidata" | "brave"; candidates?: Identity[]; identity?: Identity };
const clean = (s: string) => s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&");
const normalize = (s: string) => s.toLowerCase().replace(/^@/, "").trim();
export function parseProfile(raw: string): { platform: string; username: string; url: string } | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
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
  constructor(public code: string, message: string, public status: number, public retryAfter?: number) { super(message); }
}
type Snak = { snaktype?: string; datavalue?: { value?: unknown } };
type Claim = { rank?: string; mainsnak?: Snak; qualifiers?: Record<string, Snak[]> };
type Entity = { id?: string; labels?: Record<string, { value?: string }>; descriptions?: Record<string, { value?: string }>; claims?: Record<string, Claim[]> };
const socialProperties = [
  ["P5797", "https://twitch.tv/"], ["P11245", "https://youtube.com/@"],
  ["P2397", "https://youtube.com/channel/"], ["P2003", "https://instagram.com/"],
  ["P7085", "https://tiktok.com/@"], ["P2002", "https://x.com/"],
  ["P13863", "https://kick.com/"], ["P2013", "https://facebook.com/"],
  ["P4265", "https://reddit.com/user/"], ["P11892", "https://threads.net/@"],
  ["P2984", "https://snapchat.com/add/"], ["P9078", "https://discord.gg/"],
] as const;
function identifier(snak?: Snak) {
  const value = snak?.datavalue?.value;
  return snak?.snaktype === "value" && typeof value === "string" && /^@?[\w.-]{1,100}$/.test(value) ? value.replace(/^@/, "") : null;
}
export function identityFromEntity(entity: Entity): Identity | null {
  if (!entity.id || !/^Q[1-9]\d*$/.test(entity.id)) return null;
  const sourceUrl = `https://www.wikidata.org/wiki/${entity.id}`;
  const name = entity.labels?.en?.value || entity.id;
  const description = entity.descriptions?.en?.value || "";
  const accounts = new Map<string, Account>();
  for (const [property, prefix] of socialProperties) {
    if (property === "P2397" && [...accounts.values()].some(a => a.platform === "youtube")) continue;
    const claims = property === "P9078" ? [...(entity.claims?.P9078 || []), ...(entity.claims?.P9345 || []).flatMap(c => (c.qualifiers?.P9078 || []).map(snak => ({ ...c, mainsnak: snak })))] : entity.claims?.[property] || [];
    for (const claim of claims) {
      if (claim.rank === "deprecated" || claim.qualifiers?.P582?.length) continue;
      const value = identifier(claim.mainsnak);
      if (!value) continue;
      const parsed = parseProfile(`${prefix}${value}`);
      if (!parsed || accounts.has(parsed.url)) continue;
      accounts.set(parsed.url, { ...parsed, title: name, description: "", confidence: "Wikidata record", evidence: "Listed on this Wikidata entry. Community-maintained data; ownership is not independently verified.", sourceUrl: `${sourceUrl}#${property === "P9078" ? "P9345" : property}` });
    }
  }
  return { id: entity.id, name, description, sourceUrl, accounts: [...accounts.values()] };
}
let wikidataCooldown = 0;
async function wikidataRequest(params: Record<string, string>) {
  if (wikidataCooldown > Date.now()) throw new SearchError("RATE_LIMITED", "Wikidata is busy. Please try again shortly.", 429, Math.ceil((wikidataCooldown - Date.now()) / 1000));
  const url = new URL("https://www.wikidata.org/w/api.php");
  url.search = new URLSearchParams({ ...params, format: "json", maxlag: "5" }).toString();
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "SocialAtlas/1.0 (https://github.com/sugeindok-alt/Nicklas-sine-nettsider)" }, signal: AbortSignal.timeout(12000), cache: "no-store" });
  } catch { throw new SearchError("UNAVAILABLE", "The free Wikidata service could not be reached. Please try again shortly.", 502); }
  const retryHeader = response.headers.get("Retry-After");
  const retrySeconds = retryHeader ? (Number(retryHeader) || (Date.parse(retryHeader) - Date.now()) / 1000) : 60;
  if (response.status === 429 || response.status === 503) {
    const delay = Number.isFinite(retrySeconds) ? Math.max(1, Math.ceil(retrySeconds)) : 60;
    wikidataCooldown = Date.now() + delay * 1000;
    throw new SearchError("RATE_LIMITED", "Wikidata is busy. Please try again shortly.", 429, delay);
  }
  if (!response.ok) throw new SearchError("PROVIDER_ERROR", "Wikidata could not complete this search. Please try again later.", 502);
  let data: { search?: { id?: string }[]; entities?: Record<string, Entity>; error?: { code?: string } };
  try { data = await response.json() as typeof data; }
  catch { throw new SearchError("PROVIDER_ERROR", "Wikidata returned an unreadable response. Please try again later.", 502); }
  if (!data || typeof data !== "object") throw new SearchError("PROVIDER_ERROR", "Wikidata returned an incomplete response.", 502);
  if (data.error) {
    if (data.error.code === "maxlag" || data.error.code === "ratelimited") {
      wikidataCooldown = Date.now() + 60000;
      throw new SearchError("RATE_LIMITED", "Wikidata is busy. Please try again in a minute.", 429, 60);
    }
    throw new SearchError("PROVIDER_ERROR", "Wikidata could not complete this search.", 502);
  }
  return data;
}
async function discoverWikidata(query: string): Promise<Discovery> {
  const found = await wikidataRequest({ action: "wbsearchentities", search: query, language: "en", uselang: "en", type: "item", limit: "5" });
  if (!Array.isArray(found.search)) throw new SearchError("PROVIDER_ERROR", "Wikidata returned an incomplete search response.", 502);
  const ids = [...new Set(found.search.flatMap(item => item?.id && /^Q[1-9]\d*$/.test(item.id) ? [item.id] : []))].slice(0, 5);
  const candidates: Identity[] = [];
  if (ids.length) {
    const details = await wikidataRequest({ action: "wbgetentities", ids: ids.join("|"), props: "claims|labels|descriptions", languages: "en" });
    if (!details.entities || typeof details.entities !== "object") throw new SearchError("PROVIDER_ERROR", "Wikidata returned incomplete account records.", 502);
    for (const id of ids) {
      const entity = details.entities[id];
      const identity = entity?.id === id ? identityFromEntity(entity) : null;
      if (identity) candidates.push(identity);
    }
  }
  const identity = candidates.length === 1 ? candidates[0] : undefined;
  return { query, provider: "wikidata", accounts: identity?.accounts || [], identity, candidates, ambiguous: candidates.length > 1, searchedAt: new Date().toISOString() };
}
async function discoverBrave(query: string): Promise<Discovery> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) throw new SearchError("NOT_CONFIGURED", "Optional Brave search needs an API key. The site owner can switch SEARCH_PROVIDER to wikidata for free discovery.", 503);
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
  return { query, provider: "brave", accounts, searchedAt: new Date().toISOString(), ambiguous: accounts.some(a => accounts.filter(b => b.platform === a.platform).length > 1) };
}
const cache = new Map<string, { expires: number; result: Discovery }>();
const inflight = new Map<string, Promise<Discovery>>();
export async function discover(query: string): Promise<Discovery> {
  const provider = process.env.SEARCH_PROVIDER?.trim().toLowerCase() || "wikidata";
  if (provider !== "wikidata" && provider !== "brave") throw new SearchError("NOT_CONFIGURED", "The search provider is invalid. Choose wikidata for free discovery.", 503);
  const normalized = `${provider}:${query.toLowerCase()}`;
  const cached = cache.get(normalized);
  if (cached && cached.expires > Date.now()) return { ...cached.result, cached: true };
  if (inflight.has(normalized)) return inflight.get(normalized)!;
  const task = (async () => {
    const result = await (provider === "wikidata" ? discoverWikidata(query) : discoverBrave(query));
    const configuredTtl = Number(provider === "wikidata" ? process.env.WIKIDATA_CACHE_TTL_SECONDS ?? 600 : process.env.SEARCH_CACHE_TTL_SECONDS ?? 0);
    const ttl = Number.isFinite(configuredTtl) ? Math.min(3600, Math.max(0, configuredTtl)) : 0;
    if (ttl) {
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(normalized, { expires: Date.now() + ttl * 1000, result });
    }
    return result;
  })();
  inflight.set(normalized, task);
  try { return await task; } finally { inflight.delete(normalized); }
}

