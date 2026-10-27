"use client";
import { useEffect, useRef, useState } from "react";
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
export function Installable({ busy }: { busy: boolean }) {
  const [install, setInstall] = useState<InstallEvent | null>(null),
    [waiting, setWaiting] = useState<ServiceWorker | null>(null),
    [dismissed, setDismissed] = useState(false),
    [error, setError] = useState("");
  const updating = useRef(false);
  useEffect(() => {
    let alive = true;
    const offer = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", offer);
    const changed = () => {
      if (updating.current) location.reload();
    };
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", changed);
      navigator.serviceWorker
        .register("/sw.js", { updateViaCache: "none" })
        .then((reg) => {
          if (!alive) return;
          if (reg.waiting) setWaiting(reg.waiting);
          reg.addEventListener("updatefound", () => {
            const worker = reg.installing;
            worker?.addEventListener("statechange", () => {
              if (
                alive &&
                worker.state === "installed" &&
                navigator.serviceWorker.controller
              )
                setWaiting(reg.waiting);
            });
          });
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
      window.removeEventListener("beforeinstallprompt", offer);
      navigator.serviceWorker?.removeEventListener("controllerchange", changed);
    };
  }, []);
  if (busy || (!waiting && (!install || dismissed))) return null;
  return (
    <aside className="install-banner">
      <div>
        <b>{waiting ? "DuelZone update ready" : "Keep the arena close."}</b>
        <span>
          {waiting
            ? busy
              ? "Finish your match before updating."
              : "Apply the latest version when you’re ready."
            : "Install DuelZone for a dedicated app window."}
        </span>
        {error && <small role="alert">{error}</small>}
      </div>
      {waiting ? (
        <button
          className="button primary compact"
          disabled={busy}
          onClick={() => {
            updating.current = true;
            waiting.postMessage({ type: "APPLY_UPDATE" });
          }}
        >
          Update
        </button>
      ) : (
        <>
          <button
            className="button secondary compact"
            onClick={() =>
              void install!
                .prompt()
                .then(() => install!.userChoice)
                .then(() => setInstall(null))
                .catch(() => setError("Use your browser’s install option."))
            }
          >
            Install
          </button>
          <button
            className="text-button"
            aria-label="Dismiss install offer"
            onClick={() => setDismissed(true)}
          >
            Later
          </button>
        </>
      )}
    </aside>
  );
}
