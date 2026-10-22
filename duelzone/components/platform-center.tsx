"use client";
import { useCallback, useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import { Bell, CheckCheck, ArrowUpRight } from "lucide-react";
import Modal from "./modal";
import type { PlatformState, Notification } from "@/lib/platform";
export type Command = (event: string, data?: unknown) => Promise<any>;
export const openFriends = (target?: string, tab = "friends", query = "") =>
  window.dispatchEvent(
    new CustomEvent("dz:friends", { detail: { target, tab, query } }),
  );
export function usePlatform(
  id: string | undefined,
  socket: Socket | null,
  connected: boolean,
  command: Command,
) {
  const [state, setState] = useState<PlatformState | null>(null),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (!id || !connected) return;
    try {
      setState((await command("platform:state")).platform);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id, connected, command]);
  useEffect(() => {
    setState(null);
  }, [id]);
  useEffect(() => {
    void refresh();
    let t: ReturnType<typeof setTimeout>;
    const changed = () => {
      clearTimeout(t);
      t = setTimeout(() => void refresh(), 150);
    };
    socket?.on("platform:changed", changed);
    return () => {
      clearTimeout(t);
      socket?.off("platform:changed", changed);
    };
  }, [socket, refresh]);
  useEffect(() => {
    if (!id || !connected) return;
    let last = Date.now(),
      away = document.hidden;
    const activity = () => {
      last = Date.now();
    };
    const check = () => {
      const next = document.hidden || Date.now() - last > 120000;
      if (next !== away) {
        away = next;
        void command("social:activity", { away }).catch(() => {});
      }
    };
    void command("social:activity", { away: document.hidden }).catch(() => {});
    const timer = setInterval(check, 15000);
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
      document.removeEventListener("visibilitychange", check);
    };
  }, [id, connected, command]);
  return { state, error, refresh };
}
export function NotificationCenter({
  state,
  command,
  onNavigate,
  error,
}: {
  state: PlatformState | null;
  command: Command;
  onNavigate: (page: "profile" | "tournaments") => void;
  error: string;
}) {
  const [open, setOpen] = useState(false),
    [failure, setFailure] = useState("");
  async function read(n?: Notification) {
    try {
      await command("notifications:read", n ? { ids: [n.id] } : {});
      if (n) {
        setOpen(false);
        if (["request", "friend", "challenge", "message"].includes(n.kind))
          openFriends(
            n.kind === "friend" || n.kind === "message"
              ? n.target || undefined
              : undefined,
            n.kind === "request"
              ? "requests"
              : n.kind === "challenge"
                ? "activity"
                : "friends",
          );
        else if (n.kind === "party")
          window.dispatchEvent(new CustomEvent("dz:party"));
        else onNavigate(n.kind === "tournament" ? "tournaments" : "profile");
      }
    } catch (e) {
      setFailure((e as Error).message);
    }
  }
  return (
    <>
      <button
        className="notification-button icon-button"
        aria-label={`Notifications${state?.unread ? `, ${state.unread} unread` : ""}`}
        onClick={() => setOpen(true)}
      >
        <Bell size={19} />
        {!!state?.unread && <b>{state.unread > 99 ? "99+" : state.unread}</b>}
      </button>
      {open && (
        <Modal title="Your activity." onClose={() => setOpen(false)}>
          <div className="notification-center">
            <div className="notification-heading">
              <span>{state?.unread || 0} unread</span>
              <button
                className="text-button"
                disabled={!state?.unread}
                onClick={() => void read()}
              >
                <CheckCheck size={15} /> Mark all read
              </button>
            </div>
            {(failure || error) && (
              <p role="alert" className="form-error">
                {failure || error}
              </p>
            )}
            {!state ? (
              <p className="muted">Connecting to your notifications…</p>
            ) : state.notifications.length ? (
              state.notifications.map((n) => (
                <button
                  key={n.id}
                  className={`notification-row ${n.read_at ? "" : "unread"}`}
                  onClick={() => void read(n)}
                >
                  <i />
                  <span>
                    <small>
                      {n.kind.toUpperCase()} ·{" "}
                      {new Date(n.created_at).toLocaleDateString()}
                    </small>
                    <b>{n.body}</b>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              ))
            ) : (
              <div className="empty-state">
                <Bell size={28} />
                <h3>You’re all caught up.</h3>
                <p>
                  Your requests, challenges and milestones will appear here.
                </p>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
