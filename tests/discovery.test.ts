import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProfile, rankResults, discover, identityFromEntity, SearchError } from "../lib/discovery";
import { GET } from "../app/api/search/route";

test("profile allowlist excludes posts, videos, deceptive hosts and unsafe schemes", () => {
  for (const url of ["https://twitch.tv.evil.test/example", "https://secret@x.com/example", "https://x.com:8443/example", "javascript:alert(1)", "http://x.com/example", "https://youtube.com/watch?v=x", "https://instagram.com/p/example", "https://x.com/example/status/123", "https://reddit.com/r/example", "https://tiktok.com/@example/video/123", "https://facebook.com/share"]) assert.equal(parseProfile(url), null, url);
});
test("canonicalizes supported profile formats and removes tracking", () => {
  for (const [url, platform, username] of [
    ["https://www.youtube.com/@test_fixture?tracking=yes", "youtube", "test_fixture"],
    ["https://www.twitch.tv/test_fixture/", "twitch", "test_fixture"],
    ["https://reddit.com/user/test_fixture", "reddit", "test_fixture"],
    ["https://snapchat.com/add/test_fixture", "snapchat", "test_fixture"],
    ["https://discord.com/invite/test_fixture", "discord", "test_fixture"],
  ]) { const result = parseProfile(url)!; assert.equal(result.platform, platform); assert.equal(result.username, username); assert.ok(!result.url.includes("?")); }
});
test("fixture matches are deduplicated and never treated as verified ownership", () => {
  const accounts = rankResults("test_fixture", [
    { title: "<b>TEST FIXTURE ONLY</b>", url: "https://twitch.tv/test_fixture" },
    { title: "TEST FIXTURE duplicate", url: "https://www.twitch.tv/test_fixture?ref=x" },
    { title: "TEST FIXTURE other identity", url: "https://instagram.com/another_fixture" },
  ]);
  assert.equal(accounts.length, 2);
  assert.equal(accounts[0].confidence, "Strong match");
  assert.equal(accounts[1].confidence, "Possible match");
  assert.equal(accounts[0].title, "TEST FIXTURE ONLY");
  assert.ok(accounts.every(a => a.evidence.includes("not independently verified") || a.evidence.includes("Confirm")));
});
test("missing credentials return an explicit configuration error", async () => {
  const previous = process.env.BRAVE_SEARCH_API_KEY;
  const previousProvider = process.env.SEARCH_PROVIDER;
  process.env.SEARCH_PROVIDER = "brave";
  delete process.env.BRAVE_SEARCH_API_KEY;
  try {
    await assert.rejects(discover("Jynxzi"), (e: unknown) => e instanceof SearchError && e.code === "NOT_CONFIGURED" && e.status === 503);
    const response = await GET(new Request("http://localhost/api/search?q=Jynxzi"));
    assert.equal(response.status, 503);
    assert.equal((await response.json() as { code: string }).code, "NOT_CONFIGURED");
  } finally { if (previous) process.env.BRAVE_SEARCH_API_KEY = previous; restoreEnv("SEARCH_PROVIDER", previousProvider); }
});
test("route rejects invalid and excessive queries", async () => {
  for (const q of ["a", "", "x".repeat(81)]) assert.equal((await GET(new Request(`http://localhost/api/search?q=${q}`))).status, 400);
});
test("actual integration maps provider fixtures, detects ambiguity, handles empty and provider failures", async () => {
  const originalFetch = globalThis.fetch;
  const previous = process.env.BRAVE_SEARCH_API_KEY;
  const previousProvider = process.env.SEARCH_PROVIDER;
  process.env.SEARCH_PROVIDER = "brave";
  process.env.BRAVE_SEARCH_API_KEY = "TEST_ONLY_NOT_A_REAL_KEY";
  let calls = 0;
  try {
    globalThis.fetch = async (input, init) => {
      calls++;
      assert.equal(new URL(String(input)).origin, "https://api.search.brave.com");
      assert.equal((init?.headers as Record<string, string>)["X-Subscription-Token"], "TEST_ONLY_NOT_A_REAL_KEY");
      return Response.json({ web: { results: [
        { title: "TEST FIXTURE A", url: "https://twitch.tv/fixture_a" },
        { title: "TEST FIXTURE B", url: "https://twitch.tv/fixture_b" },
        { title: "TEST FIXTURE VIDEO", url: "https://youtube.com/watch?v=fixture" },
      ] } });
    };
    const result = await discover("test ambiguous fixture");
    assert.equal(result.ambiguous, true);
    assert.equal(result.accounts.length, 2);
    assert.equal(calls, 2);
    globalThis.fetch = async () => Response.json({ web: { results: [] } });
    assert.equal((await discover("test empty fixture")).accounts.length, 0);
    globalThis.fetch = async () => new Response("", { status: 429 });
    await assert.rejects(discover("test quota fixture"), (e: unknown) => e instanceof SearchError && e.status === 429);
    globalThis.fetch = async () => { throw new Error("TEST NETWORK FAILURE"); };
    await assert.rejects(discover("test network fixture"), (e: unknown) => e instanceof SearchError && e.code === "UNAVAILABLE");
  } finally { globalThis.fetch = originalFetch; restoreEnv("BRAVE_SEARCH_API_KEY", previous); restoreEnv("SEARCH_PROVIDER", previousProvider); }
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
}
const snak = (value: unknown) => ({ snaktype: "value", datavalue: { value } });
const claim = (value: unknown) => ({ mainsnak: snak(value), rank: "normal" });
test("Wikidata records only expose safe current social claims and prefer YouTube handles", () => {
  const identity = identityFromEntity({
    id: "Q123", labels: { en: { value: "TEST FIXTURE PERSON" } },
    claims: {
      P2002: [claim("fixture_x"), claim("https://evil.test"), claim("bad/path"), { ...claim("old_fixture"), qualifiers: { P582: [snak("2020")] } }, { ...claim("deprecated"), rank: "deprecated" }, { mainsnak: { snaktype: "novalue" } }],
      P11245: [claim("@fixture_channel"), claim("fixture_extra"), claim("@fixture_channel")],
      P2397: [claim("UC_fixture_duplicate")],
      P2003: [claim(123)],
      P9345: [{ ...claim("123456789"), qualifiers: { P9078: [snak("fixture_invite")] } }],
    },
  })!;
  assert.deepEqual(identity.accounts.map(a => a.username), ["fixture_channel", "fixture_extra", "fixture_x", "fixture_invite"]);
  assert.ok(identity.accounts.every(a => a.confidence === "Wikidata record" && a.sourceUrl?.startsWith("https://www.wikidata.org/wiki/Q123#")));
  assert.equal(identityFromEntity({ id: "../../evil" }), null);
  assert.equal(identityFromEntity({ id: "Q124", claims: { P2397: [claim("UC_fixture")] } })!.accounts[0].url, "https://youtube.com/channel/UC_fixture");
});
test("default discovery needs no key, uses two public API calls, and caches results", async () => {
  const originalFetch = globalThis.fetch;
  const previousProvider = process.env.SEARCH_PROVIDER;
  const previousTtl = process.env.WIKIDATA_CACHE_TTL_SECONDS;
  const previousKey = process.env.BRAVE_SEARCH_API_KEY;
  delete process.env.SEARCH_PROVIDER;
  delete process.env.BRAVE_SEARCH_API_KEY;
  process.env.WIKIDATA_CACHE_TTL_SECONDS = "600";
  let calls = 0;
  try {
    globalThis.fetch = async (input, init) => {
      calls++;
      const url = new URL(String(input));
      assert.equal(url.origin, "https://www.wikidata.org");
      assert.equal(url.searchParams.get("maxlag"), "5");
      assert.ok((init?.headers as Record<string, string>)["User-Agent"].includes("SocialAtlas"));
      assert.equal((init?.headers as Record<string, string>)["X-Subscription-Token"], undefined);
      return url.searchParams.get("action") === "wbsearchentities"
        ? Response.json({ search: [{ id: "Q125" }] })
        : Response.json({ entities: { Q125: { id: "Q125", labels: { en: { value: "TEST FREE FIXTURE" } }, claims: { P5797: [claim("free_fixture")] } } } });
    };
    const results = await Promise.all([discover("test free fixture"), discover("test free fixture")]);
    assert.equal(calls, 2);
    assert.equal(results[0].provider, "wikidata");
    assert.equal(results[0].identity?.id, "Q125");
    assert.equal(results[0].accounts[0].url, "https://twitch.tv/free_fixture");
    assert.equal((await discover("test free fixture")).cached, true);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; restoreEnv("SEARCH_PROVIDER", previousProvider); restoreEnv("WIKIDATA_CACHE_TTL_SECONDS", previousTtl); restoreEnv("BRAVE_SEARCH_API_KEY", previousKey); }
});
test("free discovery keeps same-name identities separate, with honest empty and failure states", async () => {
  const originalFetch = globalThis.fetch;
  const previousProvider = process.env.SEARCH_PROVIDER;
  process.env.SEARCH_PROVIDER = "wikidata";
  try {
    globalThis.fetch = async input => new URL(String(input)).searchParams.get("action") === "wbsearchentities"
      ? Response.json({ search: [{ id: "Q126" }, { id: "Q127" }] })
      : Response.json({ entities: {
        Q126: { id: "Q126", labels: { en: { value: "TEST SHARED NAME" } }, claims: { P2003: [claim("fixture_one")] } },
        Q127: { id: "Q127", labels: { en: { value: "TEST SHARED NAME" } }, claims: { P2003: [claim("fixture_two")] } },
      } });
    const result = await discover("test distinct people");
    assert.equal(result.ambiguous, true);
    assert.equal(result.identity, undefined);
    assert.deepEqual(result.accounts, []);
    assert.equal(result.candidates?.[0].accounts[0].username, "fixture_one");
    assert.equal(result.candidates?.[1].accounts[0].username, "fixture_two");
    globalThis.fetch = async () => Response.json({ search: [] });
    assert.deepEqual((await discover("test free missing")).accounts, []);
    globalThis.fetch = async () => Response.json({});
    await assert.rejects(discover("test malformed free"), (e: unknown) => e instanceof SearchError && e.code === "PROVIDER_ERROR");
    globalThis.fetch = async () => { throw new Error("TEST NETWORK FAILURE"); };
    await assert.rejects(discover("test free network"), (e: unknown) => e instanceof SearchError && e.code === "UNAVAILABLE");
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response("", { status: 429, headers: { "Retry-After": "120" } }); };
    const response = await GET(new Request("http://localhost/api/search?q=test%20free%20quota"));
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "120");
    await assert.rejects(discover("test free cooldown"), (e: unknown) => e instanceof SearchError && e.status === 429);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; restoreEnv("SEARCH_PROVIDER", previousProvider); }
});

