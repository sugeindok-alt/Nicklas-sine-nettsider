import { randomInt, randomUUID } from "node:crypto";
import { Frontier, type Sport, type FrontierGame } from "../lib/frontier";
import { FrontierBot } from "../lib/frontier-bot";
import type { Difficulty } from "../lib/bot";
import { lengthScale } from "../lib/social";
import { replayFrame, ghostFighter, type Replay } from "../lib/replay";
import { Match, type Action } from "./game";
export class FrontierMatch extends Match {
  private engine?: Frontier;
  private loop?: ReturnType<typeof setInterval>;
  private intro?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private frame = 0;
  private round = 1;
  private bot?: FrontierBot;
  private selection?: Sport[];
  private ghost?: { data: Replay; source: string; id: string };
  configureGhost(data: Replay, source: string, id: string) {
    this.ghost = { data, source, id };
    this.state.ghost = { replayId: data.matchId, sourceId: source };
  }
  configureDraft(selection: Sport[]) {
    this.selection = selection;
    this.state.rounds = selection.length;
  }
  configureBot(id: string, difficulty: Difficulty) {
    this.bot = new FrontierBot(id, difficulty);
  }
  start() {
    this.broadcast(this.snapshot());
    this.intro = setTimeout(() => {
      if (this.stopped) return;
      this.engine = new Frontier(
        this.state.game as FrontierGame,
        this.state.players.map((p) => p.id),
        Date.now(),
        () =>
          this.ghost
            ? Math.max(
                0,
                [
                  "SUSPENSION / EAST GANTRY",
                  "SUSPENSION / HIGH LINE",
                  "SUSPENSION / LOWER DECK",
                ].indexOf(this.ghost.data.frames[0].view.map),
              ) / 3
            : randomInt(1000000) / 1000000,
        this.ghost
          ? this.ghost.data.duration / 90000
          : lengthScale[this.state.rules?.length || "standard"],
        this.selection,
      );
      if (this.ghost) {
        const initial =
            this.ghost.data.frames[0].view.players[this.ghost.source],
          human = this.engine.view.players[this.state.players[0].id];
        human.x = initial.x;
        human.y = initial.y;
      }
      this.state.challenge = { id: randomUUID() };
      this.state.phase = "active";
      this.loop = setInterval(() => this.step(), 1000 / 30);
      this.step();
    }, 2400);
  }
  private step() {
    if (!this.engine || this.stopped) return;
    const now = Date.now();
    if (this.bot) {
      const input = this.bot.think(this.engine.snapshot(this.bot.id), now);
      if (input) this.engine.action(this.bot.id, input, now);
    }
    if (this.ghost) {
      const g = this.engine.view.players[this.ghost.id];
      g.x = -1000;
      g.y = 0;
      g.vx = g.vy = 0;
    }
    this.engine.tick(now);
    const v = this.engine.view;
    if (this.ghost) {
      const recorded = replayFrame(this.ghost.data, now - v.startedAt),
        source = recorded.players[this.ghost.source];
      v.players[this.ghost.id] = ghostFighter(
        source,
        this.ghost.id,
        now,
        recorded.now,
      );
      v.points[this.ghost.id] = recorded.points[this.ghost.source];
      if (v.ended && v.history.length) {
        const last = v.history[v.history.length - 1],
          a = this.state.players[0].id,
          b = this.ghost.id;
        last.scores = { ...v.points };
        last.stats[this.ghost.id] = { ...source.stats };
        last.winner =
          v.points[a] === v.points[b]
            ? null
            : v.points[a] > v.points[b]
              ? a
              : b;
      }
    }
    if (v.round !== this.round) {
      this.round = v.round;
      this.state.challenge = { id: randomUUID() };
    }
    this.state.round = v.round;
    this.state.rounds = v.series ? this.selection?.length || 5 : 1;
    this.state.deadline = v.deadline;
    this.state.startedAt = v.startedAt;
    this.state.scores = this.engine.scores();
    if (v.ended) {
      void this.finish();
      return;
    }
    if (++this.frame % 2 === 0) this.broadcast(this.snapshot());
  }
  snapshot(viewer?: string) {
    return {
      ...super.snapshot(),
      ...(this.engine ? { frontier: this.engine.snapshot(viewer) } : {}),
    };
  }
  action(id: string, input: Action) {
    if (
      !this.stopped &&
      this.state.phase === "active" &&
      input.challengeId === this.state.challenge?.id
    )
      this.engine?.action(id, input, Date.now());
  }
  async finish(forfeit?: string) {
    this.stopped = true;
    clearTimeout(this.intro);
    clearInterval(this.loop);
    if (this.engine) {
      this.state.scores = this.engine.scores();
      this.state.frontier = this.engine.snapshot();
    }
    await super.finish(forfeit);
  }
  dispose() {
    this.stopped = true;
    clearTimeout(this.intro);
    clearInterval(this.loop);
    super.dispose();
  }
}
