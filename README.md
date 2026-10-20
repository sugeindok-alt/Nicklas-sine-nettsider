# SocialAtlas

A hosted application using Next.js App Router conventions through Vinext for finding publicly indexed social profiles. TypeScript, Tailwind CSS, Motion for React, Lucide and Simple Icons.

## Run

Requires Node.js 22.13 or newer and npm.

```powershell
npm install
Copy-Item .env.example .env.local
# Set BRAVE_SEARCH_API_KEY in .env.local, then:
npm run dev
```

Open http://127.0.0.1:5173. Restart the server after changing environment variables.

For a production build:

```powershell
npx tsc --noEmit
node --import tsx --test tests/*.test.ts
npm run build
npm start
```

## Real search configuration

Obtain a Web Search API key from [Brave Search API](https://brave.com/search/api/). Configure `BRAVE_SEARCH_API_KEY` on the server only. Do not use a `NEXT_PUBLIC_` variable. The server calls the [documented Web Search endpoint](https://api-dashboard.search.brave.com/api-reference/web/search/get) using `X-Subscription-Token`.

Each uncached search makes two sequential provider calls covering eleven platforms. Your provider subscription, quota, indexing coverage and terms determine available results. No key is bundled. Missing credentials return HTTP 503 with `NOT_CONFIGURED`; failed providers and rate limits get explicit error states. No synthetic results or fallback account arrays are served.

`SEARCH_CACHE_TTL_SECONDS` enables a bounded, process-local cache (maximum 100 queries, TTL up to 3600 seconds). It defaults to zero because search-result storage must be permitted by your provider plan. Concurrent identical requests are deduplicated even with the cache disabled. Restarting clears the cache.

## Evidence and identity

- Only recognized HTTPS profile paths are accepted. Video/post links, unsafe schemes and lookalike domains are excluded.
- An exact normalized username match is labelled **Strong match**, not verified ownership.
- Other indexed candidates are **Possible match** and require review.
- This version does not independently fetch official websites or authenticated platform data. It therefore does not claim **Officially linked**, platform verification, follower counts, profile portraits, biography or category. Search titles are displayed as search titles.
- All results require the user to choose the accounts they recognize before building a constellation. A single account per platform may be selected. Duplicate platform candidates trigger an ambiguity notice. A user's choice is not a verification claim.
- Cross-link corroboration and official platform API enrichment are not implemented. Do not treat same-name accounts as proof of a shared identity.

## Features and privacy

Keyboard-accessible search, locally sourced recent-search suggestions, favorites, shareable `/?q=...` URLs, platform filters, selectable account collections and clickable constellation nodes. Share links rerun the query; they do not persist a verified identity or account selection. Favorites store search names, not snapshots of provider data. Search history (8 entries) and favorites (20 entries) are saved only in browser local storage. No analytics are included.

Queries are sent to the server and Brave. API keys stay server-side. No arbitrary target-site fetching, private scraping or authentication bypass is performed. A conservative process-wide limiter permits 30 searches per minute; use a shared gateway rate limiter and an appropriate cost/quota policy before a multi-instance public deployment. In-memory caches and limits are per process.

Live provider autocomplete is not enabled. Suggestions are explicitly labelled recent searches.

## Validation

`node --import tsx --test tests/*.test.ts` uses isolated, explicitly named test fixtures to verify URL safety, canonicalization, ranking, deduplication, ambiguous candidates, empty results, credentials, upstream rate limits and network errors. Fixtures are never imported by the UI and are not served by the application.

For the real journey: configure a valid key, search **Jynxzi**, inspect the returned source profiles, select accounts, build the constellation, open a node, save the search, and copy its link. Results depend on what Brave can find; they are not preloaded.

Motion respects reduced-motion preferences. All principal actions support keyboard navigation. Browser storage and clipboard failures have explicit feedback. The interface adapts to mobile layouts and includes native focus-trapped information dialogs and application error/not-found pages.

## Structure

- `app/api/search/route.ts`: validated server endpoint, request limiter, sanitized errors
- `lib/discovery.ts`: provider integration, profile URL allowlist, confidence ranking, cache
- `components/atlas.tsx`: search, identity selection, constellation, saved/recent state
- `components/platform-icon.tsx`: bundled brand SVGs from Simple Icons
- `app/globals.css`: responsive visual system and reduced-motion styles

Platform logos identify destinations and do not imply affiliation. The landing constellation is labelled as a map of possibilities; it contains platform symbols, not discovered accounts.


## Hosted website

SocialAtlas uses a white interface. The deployment adapter in `vite.config.ts` and `worker/index.ts` supports Cloudflare Workers through Sites. The live deployment URL is https://socialatlas-nicklas.cherry-snow-6346.chatgpt.site. Sites controls access; the initial publication is private to the owner. Set the hosted `BRAVE_SEARCH_API_KEY` as a runtime secret through Sites, never in source or client code. The server does not return fabricated results when the key is missing.

GitHub stores the source; pushing to GitHub alone does not redeploy Sites. Build with `npm run build` and publish through the Sites workflow. GitHub Pages cannot run this application's server API.

