import { createServer } from "node:http";
import { existsSync } from "node:fs";
import express, { type ErrorRequestHandler } from "express";
import next from "next";
import { z } from "zod";
import { Database, newId } from "./db";
import {
  authenticate,
  createSession,
  cookieToken,
  digest,
  hashPassword,
  rateLimit,
  sessionPlayer,
  verifyPassword,
  type AuthRequest,
} from "./auth";
import { realtime } from "./realtime";
import { imageData } from "./media";
import { games } from "../lib/shared";

if (existsSync(".env")) process.loadEnvFile(".env");
process.env.NEXT_TELEMETRY_DISABLED = "1";
const production =
  process.argv.includes("--production") ||
  process.env.NODE_ENV === "production";
if (production) Object.assign(process.env, { NODE_ENV: "production" });
const port = Number(process.env.PORT || 3000);
const origin =
  process.env.APP_ORIGIN ||
  process.env.RENDER_EXTERNAL_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://localhost:${port}`);
const allowedOrigins = [
  ...new Set([
    origin,
    ...(process.env.EXTRA_ORIGINS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ]),
];
if (production && !origin.startsWith("https://"))
  throw new Error("Production requires an HTTPS APP_ORIGIN.");
if (
  production &&
  allowedOrigins.some(
    (value) => !value.startsWith("https://") || new URL(value).origin !== value,
  )
)
  throw new Error("Every production origin must be an exact HTTPS origin.");
if (
  (process.env.RENDER || process.env.RAILWAY_ENVIRONMENT_ID) &&
  !process.env.DATABASE_URL
)
  throw new Error(
    "Cloud hosting requires a persistent DATABASE_URL. Local ephemeral storage is not allowed.",
  );
const db = new Database();
await db.init();
const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY_HOPS)
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS));
const http = createServer(app);
const live = realtime(http, db, allowedOrigins);
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  if (production)
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  next();
});
app.use(
  "/api",
  rateLimit(60000, 240),
  express.json({ limit: "512kb" }),
  (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !allowedOrigins.includes(req.headers.origin || "")
    ) {
      res.status(403).json({ error: "Request origin rejected." });
      return;
    }
    next();
  },
);
const auth = authenticate(db);
const authLimit = rateLimit(15 * 60000, 25);
const registration = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(20)
    .regex(/^[a-zA-Z0-9_]+$/, "Use letters, numbers and underscores."),
  email: z
    .string()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase().trim()),
  password: z.string().min(12, "Use at least 12 characters.").max(128),
});
const dummy = await hashPassword("unused-constant-time-password");
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.get("/api/me", async (req, res) =>
  res.json({ player: (await sessionPlayer(db, req.headers.cookie)) || null }),
);
app.post("/api/auth/register", authLimit, async (req, res) => {
  const data = registration.parse(req.body);
  const id = newId();
  const hash = await hashPassword(data.password);
  try {
    await db.query(
      "INSERT INTO users(id,username,username_key,email,password_hash) VALUES($1,$2,$3,$4,$5)",
      [id, data.username, data.username.toLowerCase(), data.email, hash],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      res
        .status(409)
        .json({ error: "That username or email is already registered." });
      return;
    }
    throw error;
  }
  await createSession(db, id, res, production);
  res.status(201).json({ player: await db.player(id) });
});
app.post("/api/auth/login", authLimit, async (req, res) => {
  const data = z
    .object({ email: z.string().max(254), password: z.string().max(128) })
    .parse(req.body);
  const user = (
    await db.query<{ id: string; password_hash: string }>(
      "SELECT id,password_hash FROM users WHERE email=$1",
      [data.email.trim().toLowerCase()],
    )
  ).rows[0];
  const valid = await verifyPassword(
    data.password,
    user?.password_hash || dummy,
  );
  if (!user || !valid) {
    res.status(401).json({ error: "Email or password is incorrect." });
    return;
  }
  const old = cookieToken(req.headers.cookie);
  if (old)
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [digest(old)]);
  await createSession(db, user.id, res, production);
  res.json({ player: await db.player(user.id) });
});
app.post("/api/auth/logout", async (req, res) => {
  const p = await sessionPlayer(db, req.headers.cookie);
  const token = cookieToken(req.headers.cookie);
  if (token)
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [digest(token)]);
  if (p) live.disconnect(p.id);
  res.clearCookie("dz_session", {
    httpOnly: true,
    sameSite: "strict",
    secure: production,
    path: "/",
  });
  res.json({ ok: true });
});
app.get("/api/overview", async (_req, res) => {
  const season = await db.currentSeason();
  const count = (
    await db.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM matches WHERE status='finished'",
    )
  ).rows[0].count;
  res.json({ season, ...live.stats(), completed: count });
});
app.get("/api/leaderboard", async (req, res) => {
  const current = await db.currentSeason();
  const season =
    typeof req.query.season === "string" &&
    /^\d{4}-Q[1-4]$/.test(req.query.season)
      ? req.query.season
      : current.id;
  const rows = (
    await db.query(
      "SELECT u.id,u.username,u.accent,r.rating,r.games,r.wins FROM ratings r JOIN users u ON u.id=r.user_id WHERE season_id=$1 AND games>0 ORDER BY rating DESC,wins DESC,u.username_key ASC LIMIT 100",
      [season],
    )
  ).rows;
  res.json({
    rows,
    season: current,
    seasons: (await db.query("SELECT * FROM seasons ORDER BY starts_at DESC"))
      .rows,
  });
});
app.get("/api/profile/:id", async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const profile = await db.profile(id);
  if (!profile) {
    res.status(404).json({ error: "Player not found." });
    return;
  }
  res.json(profile);
});
app.get("/api/media/:id/:kind", async (req, res) => {
  const id = z.string().uuid().parse(req.params.id),
    kind = z.enum(["avatar", "banner"]).parse(req.params.kind);
  const row = (
    await db.query<{ image: string }>(
      `SELECT ${kind} AS image FROM users WHERE id=$1`,
      [id],
    )
  ).rows[0];
  if (!row?.image) {
    res.status(404).end();
    return;
  }
  const [header, data] = row.image.split(",");
  res.setHeader("Content-Type", header.slice(5).split(";")[0]);
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(Buffer.from(data, "base64"));
});
app.post("/api/profile/media", auth, async (req: AuthRequest, res) => {
  const input = z
    .object({
      avatar: imageData(80 * 1024).optional(),
      banner: imageData(200 * 1024).optional(),
      cosmetic: z.enum(["graphite", "carbon", "laurel"]),
    })
    .parse(req.body);
  const profile = await db.profile(req.player!.id);
  const peak = Math.max(
    1000,
    ...(profile!.seasons as { rating: number }[]).map((s) => s.rating),
  );
  if (
    (input.cosmetic === "carbon" && profile!.progression.level < 3) ||
    (input.cosmetic === "laurel" && peak < 1050)
  ) {
    res
      .status(403)
      .json({ error: "Earn this finish through progression first." });
    return;
  }
  await db.query(
    "UPDATE users SET avatar=COALESCE($1,avatar),banner=COALESCE($2,banner),cosmetic=$3,media_version=media_version+1 WHERE id=$4",
    [
      input.avatar ?? null,
      input.banner ?? null,
      input.cosmetic,
      req.player!.id,
    ],
  );
  res.json({ player: await db.player(req.player!.id) });
});
app.patch("/api/profile", auth, async (req: AuthRequest, res) => {
  const data = z
    .object({
      bio: z.string().trim().max(160),
      accent: z.enum(["#c8f36a", "#a5bce9", "#e8b39a", "#c2b4df", "#eeeeee"]),
    })
    .parse(req.body);
  await db.query("UPDATE users SET bio=$1,accent=$2 WHERE id=$3", [
    data.bio,
    data.accent,
    req.player!.id,
  ]);
  res.json({ player: await db.player(req.player!.id) });
});
app.post(
  "/api/auth/password",
  auth,
  authLimit,
  async (req: AuthRequest, res) => {
    const data = z
      .object({
        current: z.string().max(128),
        password: z.string().min(12).max(128),
      })
      .parse(req.body);
    const row = (
      await db.query<{ password_hash: string }>(
        "SELECT password_hash FROM users WHERE id=$1",
        [req.player!.id],
      )
    ).rows[0];
    if (!(await verifyPassword(data.current, row.password_hash))) {
      res.status(400).json({ error: "Current password is incorrect." });
      return;
    }
    await db.transaction(async (tx) => {
      await tx.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
        await hashPassword(data.password),
        req.player!.id,
      ]);
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [req.player!.id]);
    });
    live.disconnect(req.player!.id);
    await createSession(db, req.player!.id, res, production);
    res.json({ ok: true });
  },
);
app.get("/api/tournaments", async (_req, res) =>
  res.json({ tournaments: await db.tournaments() }),
);
app.post("/api/tournaments", auth, async (req: AuthRequest, res) => {
  const data = z
    .object({ name: z.string().trim().min(3).max(48), game: z.enum(games) })
    .parse(req.body);
  const id = newId();
  await db.transaction(async (tx) => {
    await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
      req.player!.id,
    ]);
    const count = (
      await tx.query<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM tournaments WHERE host_id=$1 AND status IN ('open','running')",
        [req.player!.id],
      )
    ).rows[0].count;
    if (count >= 3)
      throw new Error("You can host up to three active tournaments.");
    await tx.query(
      "INSERT INTO tournaments(id,name,game,host_id) VALUES($1,$2,$3,$4)",
      [id, data.name, data.game, req.player!.id],
    );
    await tx.query(
      "INSERT INTO entrants(tournament_id,user_id) VALUES($1,$2)",
      [id, req.player!.id],
    );
  });
  live.io.emit("refresh");
  res.status(201).json({ id });
});
app.post("/api/tournaments/:id/join", auth, async (req: AuthRequest, res) => {
  const id = z.string().uuid().parse(req.params.id);
  await db.transaction(async (tx) => {
    const t = (
      await tx.query<{ status: string }>(
        "SELECT status FROM tournaments WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    if (!t || t.status !== "open") throw new Error("Tournament is not open.");
    const entries = (
      await tx.query<{ user_id: string }>(
        "SELECT user_id FROM entrants WHERE tournament_id=$1",
        [id],
      )
    ).rows;
    if (entries.some((e) => e.user_id === req.player!.id)) return;
    if (entries.length >= 4) throw new Error("Tournament is full.");
    await tx.query(
      "INSERT INTO entrants(tournament_id,user_id) VALUES($1,$2)",
      [id, req.player!.id],
    );
  });
  await db.query(
    "UPDATE tournament_invites SET status='accepted' WHERE tournament_id=$1 AND to_id=$2 AND status='pending'",
    [id, req.player!.id],
  );
  db.notificationChanged?.(req.player!.id);
  live.io.emit("refresh");
  res.json({ ok: true });
});
app.post("/api/tournaments/:id/leave", auth, async (req: AuthRequest, res) => {
  const id = z.string().uuid().parse(req.params.id);
  await db.transaction(async (tx) => {
    const t = (
      await tx.query<{ status: string; host_id: string }>(
        "SELECT status,host_id FROM tournaments WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    if (!t || t.status !== "open")
      throw new Error("You can only leave an open tournament.");
    if (t.host_id === req.player!.id)
      await tx.query("UPDATE tournaments SET status='cancelled' WHERE id=$1", [
        id,
      ]);
    else
      await tx.query(
        "DELETE FROM entrants WHERE tournament_id=$1 AND user_id=$2",
        [id, req.player!.id],
      );
  });
  live.io.emit("refresh");
  res.json({ ok: true });
});
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "Endpoint not found." }),
);
const errors: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof z.ZodError) {
    res
      .status(400)
      .json({ error: error.issues[0]?.message || "Invalid request." });
    return;
  }
  if (error instanceof SyntaxError) {
    res.status(400).json({ error: "Invalid JSON." });
    return;
  }
  const expected = [
    "Tournament is not open.",
    "Tournament is full.",
    "You can only leave an open tournament.",
    "You can host up to three active tournaments.",
  ];
  if (expected.includes(error.message)) {
    res.status(409).json({ error: error.message });
    return;
  }
  console.error(error);
  res.status(500).json({
    error: "The server could not complete this request. Please try again.",
  });
};
app.use(errors);
if (!process.argv.includes("--api-only")) {
  const web = next({
    dev: !production,
    hostname: "localhost",
    port,
    webpack: true,
  });
  await web.prepare();
  app.use((req, res) => {
    void web.getRequestHandler()(req, res);
  });
}
http.listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log(`DuelZone ready at ${origin}`),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await live.close();
  http.close();
  await db.close();
  process.exit(0);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
process.on("message", (message) => {
  if (message === "duelzone:stop") void stop();
});
