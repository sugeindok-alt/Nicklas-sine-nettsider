# SocialAtlas

## DuelZone multiplayer application

The separate [DuelZone app](duelzone/README.md) lives in `duelzone/`: four working 1v1 games, real-time matchmaking, friend invites, accounts, persistent PostgreSQL statistics, Elo rankings and four-player tournaments. Run `cd duelzone`, `npm ci`, then `npm run dev`. The SocialAtlas app below is preserved.

A white, responsive website for discovering social accounts recorded for public figures. Built with TypeScript, Next.js App Router conventions through Vinext, Motion and bundled platform icons.

## Free search

**Wikidata is the default. No API key or paid search subscription is required.**

Enter a public figure's name or creator alias. SocialAtlas searches Wikidata, then reads the social-account claims on up to five matching entries. If several entries match, choose one; accounts from separate identities are never combined automatically.

This is a public knowledge-base lookup, not a universal username search. Many people and accounts are absent. Community records may be incomplete, outdated or incorrect. An empty result does not prove someone has no accounts. Results are labelled **Wikidata record**, link to the original entry and do not claim verified ownership.

The app supports recorded Twitch, YouTube, Instagram, TikTok, X, Kick, Facebook, Reddit, Threads, Snapchat and Discord links. It skips deprecated and end-dated claims, unsafe identifiers and non-profile URLs. YouTube handles are preferred over channel IDs to avoid displaying both forms of the same channel. Discord links require a recorded invite code; numeric server IDs alone are not usable invites.

Sources: [Wikidata data access](https://www.wikidata.org/wiki/Wikidata:Data_access), [CC0 structured data](https://www.wikidata.org/wiki/Wikidata:Licensing), [API etiquette](https://www.mediawiki.org/wiki/API:Etiquette).

## Run

Requires Node.js 22.13 or newer and npm.

```powershell
npm install
npm run dev
```

Open http://127.0.0.1:5173. No environment file is needed for the free default.

```powershell
npm run typecheck
npm test
npm run build
npm start
```

For optional settings, copy `.env.example` to `.env.local` and restart the server after changes.

## Provider settings

- `SEARCH_PROVIDER=wikidata` is the default even when a Brave key exists. There is no automatic paid fallback.
- `WIKIDATA_CACHE_TTL_SECONDS=600` caches free results for ten minutes by default. Set zero to disable. The cache is process-local, bounded to 100 entries and a maximum TTL of one hour.
- Optional `SEARCH_PROVIDER=brave` explicitly selects [Brave Web Search](https://brave.com/search/api/). It requires a server-only `BRAVE_SEARCH_API_KEY`; your provider plan determines costs and coverage. Never use a `NEXT_PUBLIC_` variable for secrets.
- `SEARCH_CACHE_TTL_SECONDS=0` is the Brave cache default. Enable only when your Brave subscription allows storing results.

A free lookup makes one name search plus one batched details request when entries match. Requests identify this app, use a timeout and `maxlag`, deduplicate concurrent identical queries, and honor rate-limit cooldowns. Upstream failures are displayed as errors, not empty results or fabricated accounts. The server allows 30 searches per minute per process; upstream quotas and availability still apply. Multi-instance deployments need shared rate limiting if used at larger scale.

## Evidence and privacy

Select the accounts you recognize before building the constellation. Several accounts on one platform can be selected. This selection is a personal collection, not a verification claim. Optional Brave results use **Strong match** for an exact username and **Possible match** otherwise; neither establishes ownership.

Only allowlisted social claims, entry names and public descriptions are returned. No portraits, follower counts, private data or platform verification badges are invented. The name and description come from the displayed Wikidata entry.

Queries go to this server and the selected provider. No arbitrary target-site fetching, login bypass or private scraping is performed. Recent searches (8) and saved searches (20) stay in this browser's local storage. Saved searches contain query names, not account snapshots. Share links include the query and rerun the search; identity/account selections are not persisted. There is no analytics code. In-memory caches clear when the server restarts.

## Validation

`npm test` checks URL safety, canonicalization, source attribution, ignored claims, YouTube deduplication, separate identities, the keyless default, request deduplication, cache behavior, empty results, malformed responses, rate limits and network errors. All mocked data is explicitly labelled test fixtures and is never served by the application.

For a live check, search **Jynxzi**, inspect the source records, select profiles, build the constellation, filter by platform, save the search and copy its link. Results come from the public API, not a bundled result list. Keyboard navigation, reduced motion, mobile layouts, native dialogs, and storage/clipboard error feedback are included.

## Hosted website

[Open SocialAtlas](https://socialatlas-nicklas.cherry-snow-6346.chatgpt.site).

The existing Sites deployment is owner-private and requires the owner's sign-in. The free search method does not change hosting access or hosting-plan terms. No search secret is needed for the default provider.

The Cloudflare Worker adapter is in `vite.config.ts` and `worker/index.ts`. Pushing source to GitHub alone does not redeploy Sites; build and publish through the Sites workflow. GitHub Pages cannot execute this server API.

Key files: `lib/discovery.ts` handles providers and evidence; `app/api/search/route.ts` validates queries and limits requests; `components/atlas.tsx` provides discovery and selection; `app/globals.css` and `app/light.css` style the interface.

Platform logos identify destinations and do not imply affiliation. The landing constellation is decorative and shows supported platforms, not discovered accounts.
