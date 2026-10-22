import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response, NextFunction } from "express";
import type { Database } from "./db";
import type { Player } from "../lib/shared";
const scrypt = promisify(scryptCallback);
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(key, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function cookieToken(cookie: string | undefined) {
  return cookie
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("dz_session="))
    ?.slice(11);
}
export async function sessionPlayer(
  db: Database,
  cookie: string | undefined,
): Promise<Player | undefined> {
  const token = cookieToken(cookie);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return;
  return (
    await db.query<Player>(
      "SELECT u.id,u.username,u.accent,u.bio,u.cosmetic,CASE WHEN u.avatar<>'' THEN '/api/media/'||u.id||'/avatar?v='||u.media_version ELSE '' END AS avatar,CASE WHEN u.banner<>'' THEN '/api/media/'||u.id||'/banner?v='||u.media_version ELSE '' END AS banner FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at>now()",
      [digest(token)],
    )
  ).rows[0];
}
export async function createSession(
  db: Database,
  id: string,
  res: Response,
  secure: boolean,
) {
  const token = randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions VALUES($1,$2,now()+interval '7 days')", [
    digest(token),
    id,
  ]);
  res.cookie("dz_session", token, {
    httpOnly: true,
    sameSite: "strict",
    secure,
    maxAge: 604800000,
    path: "/",
  });
}
export type AuthRequest = Request & { player?: Player };
export function authenticate(db: Database) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    req.player = await sessionPlayer(db, req.headers.cookie);
    if (!req.player) {
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }
    next();
  };
}
export function rateLimit(windowMs: number, max: number) {
  const buckets = new Map<string, { n: number; until: number }>();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of buckets) if (v.until < now) buckets.delete(k);
  }, 60000);
  timer.unref();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || "unknown",
      now = Date.now();
    let b = buckets.get(key);
    if (!b || b.until < now) {
      b = { n: 0, until: now + windowMs };
      buckets.set(key, b);
    }
    if (++b.n > max) {
      res.setHeader("Retry-After", Math.ceil((b.until - now) / 1000));
      res
        .status(429)
        .json({ error: "Too many attempts. Please try again shortly." });
      return;
    }
    next();
  };
}
