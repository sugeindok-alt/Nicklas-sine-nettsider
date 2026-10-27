# DuelZone 2.0 implementation record

## Baseline and preservation contract — 27 October 2026

Baseline: `96afc41` on `feat/duelzone-gameplay`. Keep the existing Render service and https://duelzone-nicklas.onrender.com/. Keep PostgreSQL/Neon, session cookies, users, passwords, friends, ratings, season history, results, cosmetics and all fifteen games. No paid services. Email verification remains intentionally disabled at the owner's request.

Architecture: Next/React UI, Express HTTP API, Socket.IO, authoritative classic/competition/frontier engines, PostgreSQL in production and isolated PGlite for tests. One server owns active matches; a deployment interrupts live matches, records them as abandoned on startup, and preserves completed results. This is a single-instance deployment, not a horizontally distributed match service.

Existing and preserved: actual game previews, searchable/filterable/favourite/recent library; ranked/casual/random matchmaking; bots; prediction, interpolation and input sequencing; friend challenges/chat/privacy/block/report; authenticated spectators; persistent notifications; daily/weekly goals; seasonal Elo/history; four-player tournaments; two-player parties; responsive visual identity and reduced motion.

## Implementation checklist

- [x] Inspect repository, deployment, account/data models and existing game/network pipeline.
- [x] Finish the existing baseline checks before editing application code.
- [x] Remove redundant authoritative-state copies; measure the before/after cost and retain per-player Shadow visibility.
- [x] Improve matchmaking candidate selection and expose wait estimates only from actual matches.
- [x] Integrate Daily Duel: UTC deterministic target circuit, server scoring, persisted attempts, daily board and previous records, no opponent required.
- [x] Add transactionally awarded game mastery with bounded rewards, meaningful records and cosmetic milestones.
- [x] Add synchronized Showdown Draft while retaining random Showdown.
- [x] Expand private lobbies to eight members with exactly two active seats, host/ready controls and privacy-respecting spectator seats.
- [x] Integrate these features into the existing dashboard, profiles, navigation and match flows with desktop/mobile polish.
- [x] Add and run focused validation for the new boundaries and real two-session interaction checks.
- [ ] Publish through the existing GitHub/Render pipeline and verify the same public HTTPS/WSS service.

Additional delivered integrations: persistent training history and legal-input bots for all 15 games; versioned compressed replays for Knockout, Momentum, Grapple and Core; real Grapple ghost races; goal/comeback/close-finish replay markers and consent-controlled links; optional friend activity; eight-player private/public ready-check brackets; earned nameplates and shared cosmetic frame/intro/result finishes; private feedback review; actual RTT/jitter/FPS diagnostics; install manifest, offline fallback and deferred updates.

This is an extension of the established visual design. Existing previews, library search/favourites/recent filters, rivalry comparisons, seasonal Elo/history, notifications, friend messages and spectators remain integrated. Ranked Showdown uses a three-discipline draft; casual random Showdown remains five disciplines. The original 15 games remain available.

## Data and deployment risks

Use additive `IF NOT EXISTS` tables/columns; no account/reset/destructive migrations. New records must have foreign keys, server-owned scores, idempotent settlement and bounded queries. Party membership and rules remain compatible with old two-person rooms. Match-mode additions must not enter ranked settlement accidentally. Never cache authenticated API/socket traffic.

Rollback: first stop admitting new matches, let active tournaments finish where practical, then redeploy `96afc41` on the same Render service without deleting new additive tables. Before an older release is started, archive any unfinished eight-player tournaments by marking their status `interrupted` and close expanded parties through the existing host controls. The old release only understands four-player brackets and two-person parties. Do not roll back application code while eight-player brackets are active. Before rollout, let active matches finish if practical. Existing completed results and authentication remain valid. Free Render cold starts and restarts cannot provide uninterrupted in-memory matches; do not claim otherwise. Provider backup/restore capabilities must be verified rather than assumed, and no secrets may appear in code or reports.

## Evidence

Baseline before application edits: typecheck, 33 unit tests, production build/smoke, classic integration, live gameplay, experience, social, frontier and platform suites all passed.

Final local verification: 37 unit tests passed; TypeScript and production webpack build passed; production startup/security-cookie smoke passed. Classic integration (14 checks), live games, experience, social, all six frontier modes, platform and evolution suites passed. The final mastery guard also passed a focused repeat: all-zero Showdown rounds cannot earn mastery from automatic tie points. Expanded-party/training test expectations were updated to include spectator members and the newly completed ghost run.

The evolution suite completes a real recorded Grapple run and a full ghost race, validates identical final ghost scores, stores both ghost and classic AI training, runs seven fixtures in an eight-player bracket, verifies Daily scoring/deduplication, bans/draft ownership, eight-person room capacity, spectator revocation, replay consent/revocation, feedback ownership, private activity and database restart persistence.

Separate authenticated in-app and Chrome sessions verified automatic pairing, simultaneous Core movement, reconnect, matching completed scores, mutual rematch, friendship/request notification, private-room invite/chat/readiness and synchronized three-round Showdown choices/launch. A real Daily target hit saved 81 points and appeared on its board. The Core recording played, paused, sought to the end and changed speed in the browser. These are agent-driven browser sessions, not a two-human playtest or a mobile-device hardware benchmark. Existing latency tests cover 60/140/220 ms RTT, jitter and dropped samples. The final experience run received 69/69 compact frames and used 24.2% fewer bytes than equivalent full snapshots.

Desktop and 390px screenshots were inspected for the homepage/dashboard, library, queue, HUD/results, profiles, leaderboard, friends, tournaments, Daily Duel, training and replay. Fixes from inspection include readable draft buttons, the correct three-round HUD, fractional series scores and participant-relative forfeit wording. No browser console errors were observed in the inspected local session. Screenshots are local QA artifacts, not production seed content.

Every integration suite uses isolated local databases and QA accounts; no sample players or fabricated results are published to production. GitHub/Render verification remains a separate release gate.

### Measured performance

`scripts/evolution-benchmark.ts` compares the former five-copy two-player snapshot preparation with the new shared immutable snapshot plus replay capture, median of 11 runs of 600 updates on this PC. Grapple: 277.75 ms to 80.21 ms (71.1% lower). Core: 87.74 ms to 24.33 ms (72.3% lower). This measures preparation CPU, not total server time, network latency or rendered FPS. Thirty tournament listings now issue three batched queries instead of 61. The existing prediction/interpolation remains in place; no unsupported 60 FPS guarantee.

### Additive database migrations

Startup adds `daily_attempts`, `game_mastery`, `mastery_events`, `training_runs`, `activity_events`, `feedback`, `party_messages`, `match_replays` and supporting indexes. Columns: `users.mastery_badge`; `party_members.role`; `parties.match_id`; `tournaments.capacity/private`; `entrants.ready`. Existing parties default to player seats, existing tournaments to four/public. Mastery XP starts with this update; historical match counts/records remain visible. Mastery is awarded inside the original atomic match settlement with per-match deduplication and daily/opponent caps.

Restart resets readiness in open tournaments and abandons unfinished Daily attempts; existing match/tournament startup recovery remains. Completed attempts, replay rows, accounts, sessions, friendships, statistics and achievements persist. There are no account migrations, password changes or destructive user/result changes.

### Operational limits and follow-up

- One Node instance owns live queues/drafts/matches. Free Render can sleep and redeployments interrupt current games; completed data lives in Neon. Horizontal scaling and uninterrupted in-flight recovery are not implemented.
- Replays cover four physics games; Shadow/Showdown are excluded to avoid recording hidden information for opponents. Version 1 stores authoritative snapshots around five times per second, gzip up to 300 KB, at most 800 frames/150 seconds. The latest 200 recordings are retained (at most ~60 MB compressed); historical match results never expire with recordings.
- Ghosts support Grapple only, from actual accessible recordings on the same course. They are explicitly labelled recordings and only save training records. Other ghost games are not exposed.
- Replay sharing and friend activity default off. Both recorded players must opt in before a public replay/highlight link works. Either player can revoke access through privacy settings. No video export is claimed or shown.
- Existing supported spectator games remain read-only and opt-in. No new spectator delay or multi-player engine is claimed: eight lobby members means two active players and six spectator seats.
- Daily Duel resets at midnight UTC; local reset time is displayed. Thirty attempts/day, one server-validated shot per target. Latency can affect aim scoring. It is not a cheat-proof tournament system; server validation does not eliminate aim automation.
- Cosmetics remain visual only. Avatar/banner uploads, three earned shared finishes, specialist nameplates and earned automatic profile titles are supported. Independent configurable intro/victory effects and a title selector are not included.
- PWA caches only offline fallback and icons, never authenticated API, socket traffic or gameplay pages. Installation depends on browser support. Updates are user-triggered and disabled during queue/draft/Daily/matches. No offline multiplayer.
- Email verification stays disabled at the owner's explicit request. Existing salted-password/session authentication and account records remain unchanged.
- Automated off-site database backups are NOT configured or claimed. The authenticated Neon production branch overview was checked on 27 October 2026: current provider history retention is six hours on the existing free plan. A restore was not performed. Longer-term off-site retention and a rehearsed recovery policy remain necessary. Before production maintenance, use Neon restore/branch capabilities if available, or PostgreSQL `pg_dump --format=custom` with the existing secret connection supplied privately, then restore to a separate database using `pg_restore --no-owner --no-acl`. Never test a restore against production or commit dump files. Rollback of code is not a database backup.
- Feedback is stored privately with five submissions/day. Ratings require an owned completed match. Owner review: `npm run feedback -- list|show <id>|resolve <id>` with private database credentials. This does not run server initialization or expose an admin endpoint. Existing player reports remain available; no automatic moderation is claimed.
