# DuelZone

A competitive 1v1 web application with fifteen game modes, real WebSocket matchmaking, private friend challenges, Elo seasons, player profiles, history, achievements, daily challenges and four-player knockout tournaments. No seeded players, simulated matchmaking, or generated standings.

## Gameplay expansion: phase one

The five priority physics games and **DuelZone Showdown** extend the existing nine games. All use the existing accounts, friends, private challenges, queues, ranked settlement and rematches. The deployment remains https://duelzone-nicklas.onrender.com on the same free Render service and Neon database.

| Mode | Rules | Controls |
| --- | --- | --- |
| Knockout Arena | Shrinking platform; charged shoves, directional blocks and dash collisions. First to three ring-outs or the lead at 90 seconds. | WASD/arrows, Space dash, hold/release J shove, K block |
| Momentum Ball | A shared physical ball, bank shots, braking and charged kicks. First to five goals or the lead at 90 seconds. | WASD/arrows, Space dash, hold/release J shoot, K brake |
| Grapple Rush | A long suspension course with gaps, overhead anchors, momentum, checkpoints and a tracking camera. First to finish; furthest progress breaks a timed match. | A/D, W jump, hold J grapple/release to swing free, Space boost |
| Shadow Hunt | Equal hunter/runner time budgets across two legs. Collect three caches and extract, or scan and catch the runner. Hidden runner coordinates are stripped server-side from the hunter's packets. | WASD/arrows, Space dash, J scan, K sneak |
| Core Control | Hold an uncontested rotating objective, displace rivals with pulses, use cover and block. Highest occupation score wins. | WASD/arrows, Space dash, hold/release J pulse, K block |
| Showdown | Five distinct priority modes in a random order, short rounds and automatic transitions. First to three round points wins; a drawn round gives each player half a point. After five rounds the higher total wins. | Controls change with the discipline |

Mouse aiming and held mouse attacks are supported, alongside touch movement/action buttons. AI practice is available in all six priority modes at four difficulties; bots submit ordinary controls and respect hidden information. Practice does not change rankings or XP. Spectators can watch Knockout, Momentum, Grapple and Core with the existing mutual opt-in. Shadow and Showdown are excluded to protect hidden information.

The physics simulation runs at 30 Hz with 60 Hz substeps and swept movement against walls; snapshots run at 15 Hz. Canvas renders independently at display refresh rate. Acknowledged inputs support local prediction/reconciliation, opponents interpolate buffered states, and obsolete inputs expire. Static map geometry is sent on reliable round changes rather than every frame. Inputs, collision results, goals, objectives and wins are server-authoritative. Existing 20-second reconnect grace applies.

An additive `matches.details` JSONB column stores round scores and statistics. Showdown's half-points are stored as integer units (two units per win) and presented as round points in the scoreboard/history. No existing accounts, passwords or results are rewritten.

Focused validation: `node --import tsx --test tests/frontier.test.ts` checks the new mechanics and visibility boundary; `npm run test:frontier` runs complete games with twelve authenticated clients, simultaneous movement, 35–95 ms delayed inputs, jitter and dropped samples, plus friend-to-Showdown, persistence, reconnect, rematch and AI integration. These are controlled clients, not a two-human playtest.

The remaining seventeen requested modes are subsequent phases and are not presented as playable: Blade Dash, Ricochet, Gravity Duel, Wallrun Tag, Floor Collapse, Drift Battle, Drone Hunt, Orb Heist, Trap Masters, Territory Wars, Portal Duel, Mini Heist, Rift Race, Tower Rush, Freeze Fight, Laser Lab, and Build & Battle. Their release should follow the same working-game-first approach; no placeholder buttons are added.

This is a separate application in `duelzone/`. The repository's existing SocialAtlas application remains at the root.

## Run locally

Requires Node.js 22.13+ (Node.js 24 recommended).

```sh
cd duelzone
npm ci
npm run dev
```

Open **http://localhost:3000**. Register two different accounts in two browser profiles, or one regular and one private window. Choose the same game and match type, then **Find a match** in both windows. Alternatively, **Challenge a friend**, copy the invite and open it in the other signed-in window. A single account cannot be its own opponent; connecting the same account twice transfers its live connection to the latest tab.

**Quick Match** immediately searches the casual queue across all available modes. Two Quick Match players get a randomly selected game; a player queued for a specific mode is also compatible. Cancel stops the search, and a lost connection cancels the queue. A real opponent automatically opens the VS introduction and match. One player alone stays in the queue until another joins.

**Play vs AI** offers the five skill disciplines plus the six priority expansion modes at Easy, Medium, Hard and Expert. Bots read the same visible game state and submit ordinary movements, captures, shots and answers. Difficulty changes reaction time, aim error, memory accuracy and hazard anticipation. Bots are clearly labelled, never appear as online humans, and create no accounts, persistent match history, XP or ranked results. AI rematches start immediately. Solo warm-ups remain available.

Local data persists in `.data/postgres/` using PGlite, an embedded PostgreSQL engine. It is not browser storage or a mock database. Restarting preserves accounts, sessions, completed matches, statistics and brackets. Setting `DATABASE_URL` switches to standard PostgreSQL using the same SQL schema. Do not point multiple processes at the embedded data directory.

## Games and scoring

Each match has an introduction, live scores, a persisted result and mutual rematches. The five new modes use a shared authoritative simulation, with 20 Hz physics and 10 Hz snapshots. Clients send inputs rather than scores. Practice runs the same rules locally without opponents or rewards.

Movement uses immediate client prediction with acknowledged input sequences and smooth reconciliation to authoritative positions. Opponents interpolate buffered snapshots; moving arenas render on Canvas independently of React updates. Inputs send on direction changes with a 160 ms heartbeat, rather than on every rendered frame. Compact, volatile game frames avoid accumulating obsolete movement packets; phase changes and results remain reliable. Extrapolation is bounded and stale inputs stop. This improves responsiveness but does not remove network latency or the free host's CPU and cold-start limits.

| Game        | Format               | Competitive mechanics                                                                                                                                                                             |
| ----------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dodge Duel  | Up to 60 seconds     | Shared arena, three lives, telegraphed hazards that accelerate, WASD/arrows or drag movement, a dash with a four-second cooldown. Last survivor wins.                                             |
| Grid Rush   | 45 seconds           | Expand into adjacent tiles, steal territory, spend energy to fortify your latest capture, and control a rotating bonus tile.                                                                      |
| Aim Clash   | 45 seconds           | Both players race for moving targets. Combos multiply scores; golden targets replenish energy; decoys break streaks. Spend energy on a temporary focus ability.                                   |
| Mind Battle | Six puzzles          | Memorize sequences, solve number patterns and short logic challenges. Both players get the same puzzle; speed and consecutive correct answers increase points. Answers are never sent to clients. |
| Speed Arena | Six 12-second stages | A shuffled sequence of all four disciplines, with short transitions and normalized scoring so each stage contributes at most 1,000 points.                                                        |

The original four games remain available. These use one attempt per round; invalid or timed-out attempts receive zero. Highest score wins and equal totals draw.

| Game           | Rounds | Input                               | Scoring                                                                                                  |
| -------------- | -----: | ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Reaction Duel  |      5 | Space or tap after the green signal | 1,000 minus 1.2 times server-observed milliseconds; inputs below 80 ms and false starts score zero       |
| Aim Duel       |      8 | Click the target                    | Up to 650 for proximity to center, plus up to 350 for speed; outside the target scores zero              |
| Speed Duel     |      8 | Keys 1–4 or color buttons           | Select the ink color, not the word; correct answers earn 1,000 minus 0.3 times milliseconds, minimum 100 |
| Precision Duel |      6 | Space or tap to stop the marker     | 1,000 times the cube of normalized center accuracy; the server evaluates the marker timeline             |

Scores, random challenges, deadlines, round IDs and Elo are controlled by the server. Clients cannot submit a score or declare a winner. Replayed actions, spectators and out-of-bounds values are rejected. Timing is based on server receipt and includes connection latency. This is a casual competitive service, not a claim of cheat-proof tournament infrastructure: browser automation, bots, collusion and network advantage need additional mitigation before high-stakes competition.

## Competition

- Three daily challenges reset at midnight UTC: complete a match, complete the featured mode, and win a match. Each grants 75 XP once per day. The first five fully completed matches give 50 XP plus 25 for a win; forfeits do not award XP. Practice never changes progression.
- Eight persistent achievements grant 100 XP each and cosmetic profile titles. Levels take 500 XP. Rewards never change movement, targets, scoring or matchmaking. There are no streak penalties or paid advantages.

- Ranked matchmaking starts within 150 rating points and widens by 15 points per waiting second. Match types must match; a specific-game queue only pairs with that game or a Quick Match wildcard. Casual has no rating restriction.
- Elo starts at 1,000 with K=32. Bronze → Silver (1,050) → Gold (1,200) → Platinum (1,400) → Diamond (1,650) → Master (1,900) → Champion (2,200).
- UTC calendar quarters define seasons. Each new quarter has a fresh rating table; historical rows and match history remain in the database. The leaderboard shows the current season's top 100 players with completed ranked games.
- Casual, friend and tournament matches save stats but do not change Elo. Only the two players can accept a rematch, and both must agree.
- Disconnects have a 20-second reconnect window; ongoing round timers continue. Remaining disconnected forfeits. Explicitly leaving forfeits immediately.
- Hosts create four-player knockout tournaments. Participants join from the tournament screen. All four must be online and available to start. Two semifinals lead to one final; ties trigger a replay. Eliminated players are released; finalists remain reserved until the final ends.
- A process restart voids unfinished matches without changing rating and marks running tournaments interrupted. Completed data is retained. Zero-downtime game migration and recovery of an unfinished bracket are not implemented.

## Authentication and privacy

Passwords use salted scrypt. Random 256-bit session tokens are stored only as SHA-256 hashes in the database. Session cookies are HttpOnly, SameSite=Strict and Secure in production, with a seven-day expiry. Mutations and WebSocket handshakes require the configured origin. HTTP/auth/socket rate limits, bounded payloads, Zod validation, parameterized SQL and transactionally locked settlement protect server state. Password changes revoke existing sessions; logout invalidates the current session and disconnects its socket.

Email addresses and password hashes are never exposed in profiles or leaderboards. Player names, bios, match history and stats are public. There are no analytics, tracking pixels, ads, third-party fonts, screen capture or cloud uploads. Email verification and forgotten-password email delivery are not included; the application does not show nonfunctional recovery controls.

## Configuration

Copy `.env.example` to `.env` only if you want to override defaults. Never commit secrets or runtime data.

| Variable           | Purpose                                                                 |
| ------------------ | ----------------------------------------------------------------------- |
| `PORT`             | HTTP port, default 3000                                                 |
| `HOST`             | Bind address, default 127.0.0.1; set 0.0.0.0 in a container             |
| `APP_ORIGIN`       | Exact browser origin for CSRF and WebSockets; production requires HTTPS |
| `DATABASE_URL`     | PostgreSQL connection URL; required on cloud hosts                      |
| `EXTRA_ORIGINS`    | Optional comma-separated exact HTTPS origins for custom domains         |
| `DATA_DIR`         | Optional embedded database directory                                    |
| `TRUST_PROXY_HOPS` | Set only for a known trusted proxy chain; Compose uses one Caddy proxy  |

## Production deployment

The app needs a persistent Node process and WebSocket support. Static hosting and GitHub Pages cannot run multiplayer. Use one instance; the matchmaking and active-match coordinator currently live in memory. Multi-instance hosting requires a shared match coordinator, not just a Socket.IO adapter.

```sh
npm run build
# Configure APP_ORIGIN=https://your-domain.example and DATABASE_URL first.
npm start
```

For a VPS with Docker, the included Compose stack supplies PostgreSQL, DuelZone and Caddy with HTTPS and WebSocket forwarding. Point a domain at the host, make ports 80/443 available, then place `DUELZONE_DOMAIN=your-domain.example` and a long random URL-safe `POSTGRES_PASSWORD` in an untracked `.env` file and run:

```sh
docker compose up --build -d
```

The database and Caddy data use named volumes. Back up PostgreSQL regularly. Do not scale the web service above one instance. Docker deployment must be verified on the target host; it is supplied as configuration, not evidence that the site is already online.

The Next.js custom server is required to host Socket.IO on the same origin. See [Next.js custom servers](https://nextjs.org/docs/app/guides/custom-server) and [PGlite persistence](https://pglite.dev/docs/).

### Railway

The included `railway.json` uses the Dockerfile, one always-running instance, `/api/health`, and bounded restarts. A connected Railway account with available credits or an approved paid plan is required; adding these files does not publish the app.

1. Create a Railway project and add PostgreSQL. Keep database access on the private network.
2. Add the GitHub repository `sugeindok-alt/Nicklas-sine-nettsider`, branch `feat/duelzone`. Set **Root Directory** to `/duelzone` and **Config File** to `/duelzone/railway.json`. Do not deploy the repository root, which contains SocialAtlas.
3. Generate a public domain for the web service, targeting port `3000`. Set the following variables before deploying:

   | Variable           | Value                                                               |
   | ------------------ | ------------------------------------------------------------------- |
   | `DATABASE_URL`     | `${{Postgres.DATABASE_URL}}` (use the actual database service name) |
   | `APP_ORIGIN`       | `https://${{RAILWAY_PUBLIC_DOMAIN}}`                                |
   | `HOST`             | `0.0.0.0`                                                           |
   | `PORT`             | `3000`                                                              |
   | `TRUST_PROXY_HOPS` | `1` when Railway is the sole trusted reverse proxy                  |

4. Confirm the database is ready, then deploy the web service. Keep exactly one region and one replica. Disable automatic deployments so code updates cannot interrupt an active tournament unexpectedly.
5. Verify the public HTTPS page, registration, login and a complete match from two independent accounts. Restart the service and confirm accounts and completed match history remain available. Use the hosted PostgreSQL database; the container's embedded database would be lost on redeployment.

Plan updates during a quiet period: the new process marks unfinished matches abandoned on startup. Stop the old deployment before starting its replacement; do not use rolling or overlapping app instances against the same database. Keep database backups and check Railway's current usage charges before enabling a paid plan.

Railway provides HTTPS and [Socket.IO support](https://docs.railway.com/guides/socketio). See its [configuration reference](https://docs.railway.com/config-as-code/reference) and [trial limits](https://docs.railway.com/pricing/free-trial).

### Free production hosting: Render and Neon

Use a **Free Render Web Service** and an independent **Neon Free PostgreSQL** database in Frankfurt. Render's free PostgreSQL product expires after 30 days, so it is not used. Keep the database URL secret and never commit it. Both services must stay on their free plans; do not add paid resources or upgrades.

1. Connect only this repository through the Render GitHub app. Select the DuelZone release branch, root directory `duelzone`, Node runtime, Frankfurt and Free compute.
2. Build with `npm ci --include=dev && npm run build`; start with `npm start`. Set `NODE_VERSION=24`, `HOST=0.0.0.0`, `PORT=10000`, `NODE_ENV=production`, `TRUST_PROXY_HOPS=1`, and the Neon `DATABASE_URL` with TLS certificate verification. Set the health-check path to `/api/health`.
3. The app reads Render's `RENDER_EXTERNAL_URL` automatically. Frontend, HTTP API and WebSockets share this HTTPS origin; no separate browser backend URL is needed.
4. Enable **After CI Checks Pass** for automatic deployment. CI exercises all 15 games, social features and persistence. Deployment/restarts interrupt unfinished games without applying ratings; completed accounts, match history and rewards remain in Neon. Deploy at quiet times. Run one instance only.
5. Keep the same Render service to retain its `onrender.com` address across restarts and updates. Do not delete/recreate it. Free compute may sleep after 15 minutes of inactivity and take about a minute to wake. Free monthly compute, transfer and build limits still apply; this is not an always-on availability guarantee.
6. For an existing custom domain, add it in Render **Settings → Custom Domains**, then enter the DNS records shown by Render at your domain provider. Add `https://your-domain.example` to `EXTRA_ORIGINS`, save/redeploy, and wait for Render's domain verification and HTTPS certificate. Keep the Render URL as the default origin. Domain registration itself may cost money and is not included.

The database schema is additive. Migration should happen while the old server is stopped, with an offline backup and row-count verification. Preserve password hashes and user IDs; users can sign in with their existing passwords. Cookies from the old hostname do not transfer to the new hostname.

The optional `render.yaml` at the repository root documents this service configuration. Do not apply it as a second service when one already exists.

## Friends and social play

The Friends button is available throughout the signed-in app, including during matches. Search by username, accept or decline requests, message friends, view their profile and head-to-head record, and challenge them directly. Incoming requests, unread messages and the latest 50 challenge events are persisted in PostgreSQL; online/in-match presence and notifications use authenticated WebSockets.

Direct challenges last 60 seconds, require both players to be online and free, and launch a private unranked match after acceptance. Choose any of the 15 games or Random, with quick (two-thirds), standard or extended (one-and-a-half) length. The setting changes classic round counts or competitive stage durations and carries into rematches. Disconnects cancel pending invitations; server startup expires leftover invitations. Declined or cancelled requests cannot start a match.

Spectating is optional for Dodge Duel, Grid Rush and Aim Clash. Both players must enable spectators and visible presence in Privacy, and the challenge must allow spectators. A friend of either player can watch; blocking either player denies access. Spectators receive read-only match state, never enter the player roster, and cannot send gameplay actions. Privacy changes revoke active spectators. Rooms allow at most 20 spectators.

Blocking removes friendships, cancels direct invitations and prevents private messages, friend requests, challenges, invite-link matches, rematches, search discovery and spectating between the pair. Privacy switches control requests, messages, challenges, presence and spectators. Messages are stored as plain text, limited to 1,000 characters, and rendered as text. They are private within the application, not end-to-end encrypted. Message IDs make retries idempotent. Friendship pairs and pending challenges have database uniqueness constraints; writes lock both player rows in a consistent order. Persistent limits allow 15 friend requests per hour, 30 messages per minute and 10 challenges per minute, with a 10-second pair cooldown. Each list is limited to 200 accepted or pending relationships.

The additive social migration creates separate tables and adds a `rules` JSONB column to matches. It does not rewrite accounts, password hashes, previous results or ratings. No email verification or additional service credentials are required. Keep the existing Render service, Neon database and single-instance deployment.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run test:production
npm run test:integration
npm run test:live
npm run test:experience
npm run test:social
```

Unit tests cover password hashing, session parsing, Elo, season boundaries, each game's scoring, false starts, duplicate/spectator/stale inputs and atomic persistent settlement. The integration suite starts its own API server on port 3101 and creates twelve explicitly named QA accounts in a unique, ignored `test-results/` database. It exercises all four games concurrently using separate authenticated sockets, mode separation, real invites, rematches, reconnects, a complete tournament, persistence across restart, origin rejection and logout. These test players never seed the normal application.

CI runs these checks on changes to this app. Browser warm-ups, desktop/mobile layout and forms should also be checked when editing the UI. The Docker/PostgreSQL/Caddy stack requires a separate host-level deployment test.

The live integration suite creates ten isolated QA accounts and completes all five new modes through authenticated WebSockets, checking consistent results, a friend invite, reconnection, mutual rematches, reward integrity and persistence after restart. These test clients are never used as production opponents.

Experience tests cover prediction, reconciliation, two moving players with 60/140/220 ms simulated round-trip latency, jitter and 5% packet loss, all five bot modes at all four difficulties, automatic/random Quick Match, cancellation, reconnects, compact frames, a complete AI match and AI rematches without persistent rewards. These are automated independent clients, not evidence of a two-human playtest.

Social integration tests use four isolated clients on port 3104 to cover search, duplicate/self/forged requests, friendship, decline, messaging privacy, idempotency, unread/read state, offline delivery, presence, direct challenges, duplicate acceptance, custom duration, rematches, head-to-head records, spectator permissions, blocking, disconnect cancellation and persistence after restart. Production QA must use temporary accounts in private matches only and remove only its own recorded test data afterwards.

## Platform dashboard and parties

Signed-in players land on a personal dashboard with real results, rank, progression, friends, invitations and open tournaments. The game library groups all 15 disciplines, provides interactive warm-ups, search, favorites, recently played filters and personal records. Quick Match exclusions are persisted per account. Random matchmaking uses the intersection of both players' allowed games; no compatible opponent means staying in the queue. AI is always an explicit practice choice.

Notifications for requests, direct challenges, parties, tournament invitations, achievements, weekly rewards and promotions persist with individual read states. Friends can display online, away, offline or the discipline they are playing, subject to presence privacy. Away status follows inactivity or a hidden page. Existing authentication is unchanged; email verification remains disabled as requested.

Profiles support avatars and banners stored in PostgreSQL, favorite disciplines, cosmetic frames, seasonal ratings, rank history recorded from new ranked results and head-to-head rivalries. Uploaded images are resized by the client and validated by signature and size on the server (PNG/JPEG/WebP only, 80 KiB avatar and 200 KiB banner). No external upload service is required. Weekly goals reset Monday at 00:00 UTC and award 150 XP each once. Cosmetic frames unlock at level 3 or Silver; they never affect gameplay.

Parties have two seats because the existing games are 1v1. An online host invites a friend, selects a discipline and match length, and launches only after both players are ready. Changing rules, reconnecting or entering a match clears readiness. Party membership persists across restarts. Invitations expire after 90 seconds; duplicates, full rooms, non-host edits and unavailable players are rejected. Removing or blocking a friend closes their shared party. Party matches reuse the existing private match engine and rematch flow. Tournament participants can invite friends to open four-player brackets; accepting an invitation registers the recipient with capacity and friendship checks.

### Private report review

Players can report a friend or a received message from the Friends panel. Reports are stored privately in `player_reports`; there is no automatic moderation or promised response time. Blocking is available immediately. Only the site owner with database credentials can inspect reports. In a private terminal with the existing production `DATABASE_URL` set, run:

```sh
npm run reports -- list
npm run reports -- show <report-id>
npm run reports -- resolve <report-id>
```

`list` returns open report IDs, categories and dates. `show` includes the submitted details and the referenced message; handle that output as private. `resolve` only marks the report reviewed and does not ban or alter an account. The command never initializes the game server or changes active matches. Reports are limited to five per day per sender, with duplicate open reports rejected.

### Focused platform verification

`npm run test:platform` covers all four phases using isolated accounts and a temporary database: durable notifications and authorization, compatible Quick Match pools, image validation and favorites, party readiness and private launch, reconnects, tournament registration, reports and block cleanup. `platform.test.ts` covers UTC weekly resets, idempotent rewards, promotion notifications and image validation. These fixtures do not seed the public service. Browser QA uses separate Chrome and in-app sessions for friendship, notifications, party acceptance, readiness and a complete shared match.
