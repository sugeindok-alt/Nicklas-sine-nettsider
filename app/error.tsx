"use client";
export default function Error({ reset }: { reset: () => void }) { return <main className="fatal"><h1>A small interruption.</h1><p>Something went wrong while opening your atlas.</p><button onClick={reset}>Try again</button></main>; }
