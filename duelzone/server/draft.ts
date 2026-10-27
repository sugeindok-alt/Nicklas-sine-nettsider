import { randomInt, randomUUID } from "node:crypto";
import type { Socket } from "socket.io";
import { z } from "zod";
import { draftGames, selectDraft, type DraftState } from "../lib/draft";
import type { Sport } from "../lib/frontier";
import type { Player } from "../lib/shared";
type Room = {
  state: DraftState;
  priority: Sport[];
  start: (selection: Sport[]) => Promise<void>;
  release: () => void;
};
export class Drafts {
  private rooms = new Map<string, Room>();
  private timer: ReturnType<typeof setInterval>;
  constructor(private sockets: Map<string, Socket>) {
    this.timer = setInterval(() => {
      for (const room of this.rooms.values())
        if (room.state.deadline <= Date.now()) void this.advance(room);
    }, 250);
    this.timer.unref();
  }
  create(players: Player[], start: Room["start"], release: Room["release"]) {
    const priority = [...draftGames];
    for (let i = priority.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [priority[i], priority[j]] = [priority[j], priority[i]];
    }
    const state: DraftState = {
      id: randomUUID(),
      players,
      phase: "choices",
      deadline: Date.now() + 25000,
      serverNow: Date.now(),
      choices: Object.fromEntries(
        players.map((p) => [
          p.id,
          { ban: null, preferred: null, ready: false },
        ]),
      ),
      selection: [],
    };
    const room = { state, priority, start, release };
    this.rooms.set(state.id, room);
    this.emit(room);
    return state;
  }
  private emit(room: Room) {
    for (const p of room.state.players)
      this.sockets
        .get(p.id)
        ?.emit("draft", { ...room.state, serverNow: Date.now() });
  }
  private async advance(room: Room) {
    const s = room.state;
    if (s.phase === "starting" || !this.rooms.has(s.id)) return;
    if (s.phase === "choices") {
      // A timeout keeps the player's selection; absent bans use a shuffled, equal-probability priority.
      const choices = Object.values(s.choices);
      for (const choice of choices)
        if (!choice.ban)
          choice.ban = room.priority.find(
            (g) => !choices.some((c) => c.ban === g) && g !== choice.preferred,
          )!;
      s.selection = selectDraft(choices, room.priority);
      s.phase = "confirm";
      s.deadline = Date.now() + 10000;
      choices.forEach((c) => {
        c.ready = false;
      });
      this.emit(room);
      return;
    }
    s.phase = "starting";
    s.deadline = Date.now() + 60000;
    this.emit(room);
    try {
      await room.start(s.selection);
    } catch (e) {
      for (const p of s.players)
        this.sockets
          .get(p.id)
          ?.emit(
            "notice",
            e instanceof Error ? e.message : "The series could not start.",
          );
    } finally {
      this.rooms.delete(s.id);
      room.release();
      for (const p of s.players) this.sockets.get(p.id)?.emit("draft", null);
    }
  }
  cancelPlayer(id: string) {
    for (const room of this.rooms.values())
      if (
        room.state.players.some((p) => p.id === id) &&
        room.state.phase !== "starting"
      ) {
        this.rooms.delete(room.state.id);
        room.release();
        for (const p of room.state.players) {
          this.sockets.get(p.id)?.emit("draft", null);
          this.sockets
            .get(p.id)
            ?.emit(
              "notice",
              "Draft cancelled. Both players must stay connected.",
            );
        }
      }
  }
  bind(
    socket: Socket,
    event: (name: string, fn: (data: unknown) => Promise<unknown>) => void,
  ) {
    const id = socket.data.player.id as string;
    event("draft:choose", async (data) => {
      const input = z
        .object({
          id: z.string().uuid(),
          ban: z
            .enum(["knockout", "ball", "grapple", "shadow", "core"])
            .nullable(),
          preferred: z
            .enum(["knockout", "ball", "grapple", "shadow", "core"])
            .nullable(),
          ready: z.boolean(),
        })
        .parse(data);
      const room = this.rooms.get(input.id),
        s = room?.state;
      if (
        !room ||
        !s ||
        !s.choices[id] ||
        s.phase === "starting" ||
        Date.now() > s.deadline
      )
        throw Error("That draft phase has ended.");
      if (s.phase === "choices") {
        if (input.ban && input.ban === input.preferred)
          throw Error("Your preferred game cannot also be your ban.");
        s.choices[id] = {
          ban: input.ban,
          preferred: input.preferred,
          ready: input.ready,
        };
      } else s.choices[id].ready = input.ready;
      this.emit(room);
      if (Object.values(s.choices).every((c) => c.ready))
        await this.advance(room);
      return {};
    });
    event("draft:cancel", async () => {
      this.cancelPlayer(id);
      return {};
    });
  }
  dispose() {
    clearInterval(this.timer);
    for (const room of this.rooms.values()) room.release();
    this.rooms.clear();
  }
}
