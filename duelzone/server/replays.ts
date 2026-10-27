import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { randomBytes, createHash } from "node:crypto";
import type { SQL } from "./db";
import { replayGames, type Replay } from "../lib/replay";
import type { MatchState } from "../lib/shared";
const compress = promisify(gzip),
  expand = promisify(gunzip);
export const replaySchema = `
CREATE TABLE IF NOT EXISTS match_replays(match_id TEXT PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,version INTEGER NOT NULL,duration INTEGER NOT NULL,payload BYTEA NOT NULL,bytes INTEGER NOT NULL,share_hash TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS replay_recent ON match_replays(created_at DESC);
`;
export class ReplayRecorder {
  private frames: Replay["frames"] = [];
  capture(state: MatchState) {
    if (
      !state.frontier ||
      !replayGames.includes(state.game) ||
      !["active", "finished"].includes(state.phase)
    )
      return;
    const at = state.frontier.now - state.frontier.startedAt;
    if (this.frames.length >= 800 || at < 0 || at > 150000) return;
    if (
      this.frames.length &&
      state.phase !== "finished" &&
      at - this.frames.at(-1)!.at < 190
    )
      return;
    if (at <= (this.frames.at(-1)?.at ?? -1)) return;
    this.frames.push({ at, view: structuredClone(state.frontier) });
  }
  async save(sql: SQL, state: MatchState) {
    this.capture(state);
    if (
      !replayGames.includes(state.game) ||
      state.reason !== "Score" ||
      this.frames.length < 3
    )
      return;
    const duration = this.frames.at(-1)!.at,
      highlights: Replay["highlights"] = [];
    let event = 0;
    for (const frame of this.frames)
      if (frame.view.event.id !== event) {
        event = frame.view.event.id;
        if (frame.view.event.kind === "goal")
          highlights.push({ at: frame.at, label: frame.view.event.text });
      }
    const winner = state.winner;
    if (
      winner &&
      this.frames.some((f) =>
        Object.entries(f.view.points).some(
          ([id, score]) => id !== winner && score > f.view.points[winner],
        ),
      )
    )
      highlights.push({
        at: Math.max(0, duration - 5000),
        label: "Comeback finish",
      });
    const scores = Object.values(state.scores);
    if (
      Math.max(...scores) > 0 &&
      Math.abs(scores[0] - scores[1]) <= Math.max(...scores) * 0.1
    )
      highlights.push({
        at: Math.max(0, duration - 5000),
        label: "Close finish",
      });
    const data: Replay = {
      version: 1,
      matchId: state.id,
      game: state.game,
      players: state.players.map(({ id, username, accent }) => ({
        id,
        username,
        accent,
        bio: "",
      })),
      duration,
      frames: this.frames,
      highlights: highlights.slice(0, 25),
    };
    const payload = await compress(JSON.stringify(data));
    if (payload.length > 300000) return;
    await sql.query(
      "INSERT INTO match_replays(match_id,version,duration,payload,bytes) VALUES($1,1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [state.id, duration, payload, payload.length],
    );
    await sql.query(
      "DELETE FROM match_replays WHERE match_id NOT IN(SELECT match_id FROM match_replays ORDER BY created_at DESC LIMIT 200)",
    );
  }
}
export async function canReadReplay(
  sql: SQL,
  matchId: string,
  viewer?: string,
  share?: string,
) {
  const players = (
    await sql.query<{
      user_id: string;
      settings: { replays?: boolean } | null;
    }>(
      "SELECT r.user_id,s.settings FROM results r LEFT JOIN social_settings s ON s.user_id=r.user_id WHERE r.match_id=$1",
      [matchId],
    )
  ).rows;
  if (players.some((p) => p.user_id === viewer)) return true;
  if (players.length !== 2 || players.some((p) => !p.settings?.replays))
    return false;
  if (viewer) {
    if (
      (
        await sql.query(
          "SELECT 1 FROM social_blocks WHERE (owner_id=$1 AND target_id=ANY($2::text[])) OR (target_id=$1 AND owner_id=ANY($2::text[]))",
          [viewer, players.map((p) => p.user_id)],
        )
      ).rows.length
    )
      return false;
    if (
      (
        await sql.query(
          "SELECT 1 FROM friendships WHERE status='accepted' AND ((a=$1 AND b=ANY($2::text[])) OR (b=$1 AND a=ANY($2::text[])))",
          [viewer, players.map((p) => p.user_id)],
        )
      ).rows.length
    )
      return true;
  }
  if (!share) return false;
  return !!(
    await sql.query(
      "SELECT 1 FROM match_replays WHERE match_id=$1 AND share_hash=$2",
      [matchId, createHash("sha256").update(share).digest("hex")],
    )
  ).rows.length;
}
export async function loadReplay(sql: SQL, id: string): Promise<Replay | null> {
  const row = (
    await sql.query<{ version: number; payload: Uint8Array }>(
      "SELECT version,payload FROM match_replays WHERE match_id=$1",
      [id],
    )
  ).rows[0];
  if (!row || row.version !== 1) return null;
  return JSON.parse(
    (
      await expand(Buffer.from(row.payload), { maxOutputLength: 10000000 })
    ).toString("utf8"),
  );
}
export async function shareReplay(sql: SQL, id: string, owner: string) {
  if (
    !(
      await sql.query(
        "SELECT 1 FROM results WHERE match_id=$1 AND user_id=$2",
        [id, owner],
      )
    ).rows.length
  )
    throw Error("Only a participant can share this replay.");
  const consent = (
    await sql.query(
      "SELECT 1 FROM results r LEFT JOIN social_settings s ON s.user_id=r.user_id WHERE r.match_id=$1 AND COALESCE(s.settings->>'replays','false')<>'true'",
      [id],
    )
  ).rows;
  if (consent.length)
    throw Error(
      "Both players must enable replay sharing in Friends → Privacy.",
    );
  const token = randomBytes(24).toString("base64url");
  const updated = await sql.query(
    "UPDATE match_replays SET share_hash=$1 WHERE match_id=$2 RETURNING match_id",
    [createHash("sha256").update(token).digest("hex"), id],
  );
  if (!updated.rows.length) throw Error("This replay is no longer stored.");
  return token;
}
