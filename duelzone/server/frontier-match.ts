import { randomInt, randomUUID } from "node:crypto";
import { Frontier, type FrontierGame } from "../lib/frontier";
import { FrontierBot } from "../lib/frontier-bot";
import type { Difficulty } from "../lib/bot";
import { lengthScale } from "../lib/social";
import { Match, type Action } from "./game";
export class FrontierMatch extends Match {
  private engine?: Frontier;
  private loop?: ReturnType<typeof setInterval>;
  private intro?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private frame = 0;
  private round = 1;
  private bot?: FrontierBot;
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
        () => randomInt(1000000) / 1000000,
        lengthScale[this.state.rules?.length || "standard"],
      );
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
    this.engine.tick(now);
    const v = this.engine.view;
    if (v.round !== this.round) {
      this.round = v.round;
      this.state.challenge = { id: randomUUID() };
    }
    this.state.round = v.round;
    this.state.rounds = v.series ? 5 : 1;
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
