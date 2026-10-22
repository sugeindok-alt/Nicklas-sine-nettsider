import { randomInt, randomUUID } from "node:crypto";
import { Competition } from "../lib/competition";
import { Match, type Action } from "./game";
import { BotDriver, type Difficulty } from "../lib/bot";
import { lengthScale } from "../lib/social";

export class LiveMatch extends Match {
  private engine?: Competition;
  private loop?: ReturnType<typeof setInterval>;
  private intro?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private frame = 0;
  private stage = 1;
  private bot?: BotDriver;
  configureBot(id: string, difficulty: Difficulty) {
    this.bot = new BotDriver(id, difficulty);
  }
  start() {
    this.broadcast(this.snapshot());
    this.intro = setTimeout(() => {
      if (this.stopped) return;
      this.engine = new Competition(
        this.state.game,
        this.state.players.map((p) => p.id),
        Date.now(),
        () => randomInt(0, 1000000) / 1000000,
        lengthScale[this.state.rules?.length || "standard"],
      );
      this.state.challenge = { id: randomUUID() };
      this.state.phase = "active";
      this.loop = setInterval(() => this.step(), 50);
      this.step();
    }, 2400);
  }
  private step() {
    if (!this.engine || this.stopped) return;
    this.engine.tick(Date.now());
    if (this.bot) {
      const input = this.bot.think(this.engine.snapshot(), Date.now());
      if (input) this.engine.action(this.bot.id, input, Date.now());
    }
    const v = this.engine.view;
    if (this.stage !== v.stage) {
      this.stage = v.stage;
      this.state.challenge = { id: randomUUID() };
    }
    this.state.scores = this.engine.scores();
    this.state.round =
      this.state.game === "mind" ? v.puzzle?.number || 1 : v.stage;
    this.state.rounds = this.state.game === "mind" ? 6 : v.stages;
    this.state.deadline = v.stageEnds;
    this.state.startedAt = v.startedAt;
    if (v.ended) {
      void this.finish();
      return;
    }
    if (++this.frame % 2 === 0) this.broadcast(this.snapshot());
  }
  snapshot() {
    return {
      ...super.snapshot(),
      ...(this.engine ? { competition: this.engine.snapshot() } : {}),
    };
  }
  action(userId: string, action: Action) {
    if (
      this.stopped ||
      !this.engine ||
      this.state.phase !== "active" ||
      action.challengeId !== this.state.challenge?.id
    )
      return;
    this.engine.action(userId, action, Date.now());
  }
  async finish(forfeit?: string) {
    this.stopped = true;
    clearTimeout(this.intro);
    clearInterval(this.loop);
    if (this.engine) {
      this.state.scores = this.engine.scores();
      this.state.competition = this.engine.snapshot();
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
