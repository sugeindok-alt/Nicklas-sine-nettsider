"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="standalone">
      <p className="eyebrow">CONNECTION INTERRUPTED</p>
      <h1>Let’s try that again.</h1>
      <button className="button primary" onClick={reset}>
        Reload the arena
      </button>
    </main>
  );
}
