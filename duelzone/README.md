# DuelZone

A working competitive 1v1 web application: four server-scored games, real WebSocket matchmaking, private friend invites, Elo seasons, player profiles, history, and four-player knockout tournaments. No seeded players, simulated matchmaking, or generated standings.

This is a separate application in `duelzone/`. The repository's existing SocialAtlas application remains at the root.

## Run locally

Requires Node.js 22.13+ (Node.js 24 recommended).

```sh
cd duelzone
npm ci
npm run dev
```

Open **http://localhost:3000**. Register two different accounts in two browser profiles, or one regular and one private window. Choose the same game and match type, then **Find a match** in both windows. Alternatively, **Challenge a friend**, copy the invite and open it in the other signed-in window. A single account cannot be its own opponent; connecting the same account twice transfers its live connection to the latest tab.

One player alone stays in the real matchmaking queue until another joins. Warm-ups are explicitly labelled solo practice and never affect profiles or rankings.

Local data persists in `.data/postgres/` using PGlite, an embedded PostgreSQL engine. It is not browser storage or a mock database. Restarting preserves accounts, sessions, completed matches, statistics and brackets. Setting `DATABASE_URL` switches to standard PostgreSQL using the same SQL schema. Do not point multiple processes at the embedded data directory.

## Games and scoring

Each match has an introduction, server-driven rounds, live scores and a persisted result. Each player gets one attempt per round. Timed-out or invalid attempts receive zero points. The highest total wins; equal totals are draws.

| Game           | Rounds | Input                               | Scoring                                                                                                  |
| -------------- | -----: | ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Reaction Duel  |      5 | Space or tap after the green signal | 1,000 minus 1.2 times server-observed milliseconds; inputs below 80 ms and false starts score zero       |
| Aim Duel       |      8 | Click the target                    | Up to 650 for proximity to center, plus up to 350 for speed; outside the target scores zero              |
| Speed Duel     |      8 | Keys 1–4 or color buttons           | Select the ink color, not the word; correct answers earn 1,000 minus 0.3 times milliseconds, minimum 100 |
| Precision Duel |      6 | Space or tap to stop the marker     | 1,000 times the cube of normalized center accuracy; the server evaluates the marker timeline             |

Scores, random challenges, deadlines, round IDs and Elo are controlled by the server. Clients cannot submit a score or declare a winner. Replayed actions, spectators and out-of-bounds values are rejected. Timing is based on server receipt and includes connection latency. This is a casual competitive service, not a claim of cheat-proof tournament infrastructure: browser automation, bots, collusion and network advantage need additional mitigation before high-stakes competition.

## Competition

- Ranked matchmaking starts within 150 rating points and widens by 15 points per waiting second. Game and match type must match. Casual has no rating restriction.
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
| `DATABASE_URL`     | Optional PostgreSQL connection URL                                      |
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

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run test:production
npm run test:integration
```

Unit tests cover password hashing, session parsing, Elo, season boundaries, each game's scoring, false starts, duplicate/spectator/stale inputs and atomic persistent settlement. The integration suite starts its own API server on port 3101 and creates twelve explicitly named QA accounts in a unique, ignored `test-results/` database. It exercises all four games concurrently using separate authenticated sockets, mode separation, real invites, rematches, reconnects, a complete tournament, persistence across restart, origin rejection and logout. These test players never seed the normal application.

CI runs these checks on changes to this app. Browser warm-ups, desktop/mobile layout and forms should also be checked when editing the UI. The Docker/PostgreSQL/Caddy stack requires a separate host-level deployment test.
