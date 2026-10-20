import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProfile, rankResults, discover, SearchError } from "../lib/discovery";
import { GET } from "../app/api/search/route";

test("profile allowlist excludes posts, videos, deceptive hosts and unsafe schemes", () => {
  for (const url of ["https://twitch.tv.evil.test/example", "javascript:alert(1)", "http://x.com/example", "https://youtube.com/watch?v=x", "https://instagram.com/p/example", "https://x.com/example/status/123", "https://reddit.com/r/example", "https://tiktok.com/@example/video/123", "https://facebook.com/share"]) assert.equal(parseProfile(url), null, url);
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
  assert.ok(accounts.every(a => a.confidence !== "Officially linked"));
});
test("missing credentials return an explicit configuration error", async () => {
  const previous = process.env.BRAVE_SEARCH_API_KEY;
  delete process.env.BRAVE_SEARCH_API_KEY;
  try {
    await assert.rejects(discover("Jynxzi"), (e: unknown) => e instanceof SearchError && e.code === "NOT_CONFIGURED" && e.status === 503);
    const response = await GET(new Request("http://localhost/api/search?q=Jynxzi"));
    assert.equal(response.status, 503);
    assert.equal((await response.json() as { code: string }).code, "NOT_CONFIGURED");
  } finally { if (previous) process.env.BRAVE_SEARCH_API_KEY = previous; }
});
test("route rejects invalid and excessive queries", async () => {
  for (const q of ["a", "", "x".repeat(81)]) assert.equal((await GET(new Request(`http://localhost/api/search?q=${q}`))).status, 400);
});
test("actual integration maps provider fixtures, detects ambiguity, handles empty and provider failures", async () => {
  const originalFetch = globalThis.fetch;
  const previous = process.env.BRAVE_SEARCH_API_KEY;
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
  } finally { globalThis.fetch = originalFetch; if (previous) process.env.BRAVE_SEARCH_API_KEY = previous; else delete process.env.BRAVE_SEARCH_API_KEY; }
});

