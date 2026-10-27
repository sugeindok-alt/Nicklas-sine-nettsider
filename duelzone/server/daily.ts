import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io";
import { z } from "zod";
import { dailyConfig, dailyShot, type DailyRun } from "../lib/daily";
import { grantAchievement } from "./progression";
import type { Database } from "./db";
type Event = (name: string, fn: (data: unknown) => Promise<unknown>) => void;
export class DailyDuel {
  private runs = new Map<string, DailyRun>();
  private finishing = new Set<string>();
  private starting = new Set<string>();
  private retryAt = new Map<string, number>();
  private timer: ReturnType<typeof setInterval>;
  constructor(
    private db: Database,
    private sockets: Map<string, Socket>,
    private free: (id: string) => void,
  ) {
    this.timer = setInterval(() => {
      for (const [id, run] of this.runs)
        if (
          run.status === "active" &&
          Date.now() >= (this.retryAt.get(id) || 0) &&
          Date.now() >= run.startedAt + run.config.duration
        )
          void this.finish(id).catch((error) => {
            this.retryAt.set(id, Date.now() + 5000);
            console.error(
              "Daily settlement failed",
              error instanceof Error ? error.message : "unknown",
            );
          });
    }, 250);
    this.timer.unref();
  }
  active(id: string) {
    return this.starting.has(id) || this.runs.get(id)?.status === "active";
  }
  private snapshot(id: string) {
    const run = this.runs.get(id);
    return run ? { ...run, serverNow: Date.now() } : null;
  }
  private publish(id: string) {
    this.sockets.get(id)?.emit("daily:state", this.snapshot(id));
  }
  private async finish(id: string) {
    const run = this.runs.get(id);
    if (!run || run.status !== "active" || this.finishing.has(id)) return;
    this.finishing.add(id);
    try {
      await this.db.transaction(async (sql) => {
        const claimed = await sql.query(
          "UPDATE daily_attempts SET status='finished',score=$2,hits=$3,shots=$4,finished_at=now() WHERE id=$1 AND status='active' RETURNING id",
          [run.id, run.score, run.hits, run.shots],
        );
        if (!claimed.rows.length) return;
        await sql.query(
          "INSERT INTO activity_events(id,user_id,kind,score) VALUES($1,$2,'daily',$3) ON CONFLICT DO NOTHING",
          [`daily:${run.config.day}:${id}`, id, run.score],
        );
        if (run.score >= 2700) await grantAchievement(sql, id, "daily-focus");
      });
      this.retryAt.delete(id);
      run.status = "finished";
      run.saved = true;
      this.publish(id);
      this.sockets.get(id)?.emit("refresh");
      setTimeout(() => {
        if (this.runs.get(id) === run) this.runs.delete(id);
      }, 300000).unref();
    } finally {
      this.finishing.delete(id);
    }
  }
  bind(socket: Socket, event: Event) {
    const id = socket.data.player.id as string;
    if (this.active(id)) this.publish(id);
    event("daily:start", async () => {
      this.free(id);
      this.starting.add(id);
      try {
        const config = dailyConfig(),
          runId = randomUUID();
        await this.db.transaction(async (sql) => {
          await sql.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [id]);
          const tally = (
            await sql.query<{ count: number; latest: string | null }>(
              "SELECT count(*)::int AS count,max(started_at) AS latest FROM daily_attempts WHERE user_id=$1 AND day=$2",
              [id, config.day],
            )
          ).rows[0];
          if (tally.count >= 30)
            throw Error(
              "You have used today's 30 attempts. The circuit resets at midnight UTC.",
            );
          if (tally.latest && Date.now() - Date.parse(tally.latest) < 10000)
            throw Error("Wait a few seconds before starting another attempt.");
          await sql.query(
            "INSERT INTO daily_attempts(id,user_id,day,version,seed) VALUES($1,$2,$3,$4,$5)",
            [runId, id, config.day, config.version, config.seed],
          );
        });
        const startedAt = Date.now() + 2500;
        this.runs.set(id, {
          id: runId,
          config,
          startedAt,
          serverNow: Date.now(),
          status: "active",
          score: 0,
          hits: 0,
          shots: 0,
          attempted: [],
        });
        this.publish(id);
        return { state: this.snapshot(id) };
      } finally {
        this.starting.delete(id);
      }
    });
    event("daily:cancel", async () => {
      const run = this.runs.get(id);
      if (run && run.status === "active") {
        if (this.finishing.has(id))
          throw Error("Saving your result. Please wait.");
        if (Date.now() >= run.startedAt + run.config.duration) {
          await this.finish(id);
          return {};
        }
        await this.db.query(
          "UPDATE daily_attempts SET status='cancelled' WHERE id=$1 AND status='active'",
          [run.id],
        );
        run.status = "cancelled";
        this.publish(id);
        setTimeout(() => {
          if (this.runs.get(id) === run) this.runs.delete(id);
        }, 300000).unref();
      }
      return {};
    });
    socket.on("daily:shot", (data) => {
      const parsed = z
        .object({
          id: z.string().uuid(),
          index: z.number().int().min(0).max(29),
          x: z.number().min(0).max(1000),
          y: z.number().min(0).max(600),
        })
        .strict()
        .safeParse(data);
      const run = this.runs.get(id);
      if (
        !parsed.success ||
        !run ||
        run.id !== parsed.data.id ||
        run.status !== "active" ||
        run.attempted.includes(parsed.data.index)
      )
        return;
      const { index, x, y } = parsed.data,
        points = dailyShot(run.config, Date.now() - run.startedAt, index, x, y);
      if (points === null) return;
      run.attempted.push(index);
      run.shots++;
      run.score += points;
      if (points > 0) run.hits++;
      run.last = { index, points };
      this.publish(id);
    });
  }
  dispose() {
    clearInterval(this.timer);
    this.runs.clear();
  }
}
