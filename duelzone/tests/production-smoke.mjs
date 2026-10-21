import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
const port = 3102;
const server = spawn(
  process.execPath,
  ["--import", "tsx", "server/index.ts", "--production"],
  {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      APP_ORIGIN: "https://duelzone.example",
      DATABASE_URL: "",
      DATA_DIR: resolve("test-results", `production-${randomUUID()}`),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      ready = (await fetch(`http://localhost:${port}/api/health`)).ok;
      if (ready) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  assert(ready, log);
  const page = await fetch(`http://localhost:${port}`);
  assert.equal(page.status, 200);
  assert((await page.text()).includes("DuelZone"));
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  assert.match(page.headers.get("strict-transport-security"), /31536000/);
  const response = await fetch(`http://localhost:${port}/api/auth/register`, {
    method: "POST",
    headers: {
      Origin: "https://duelzone.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username: "ProductionQA",
      email: "production@example.invalid",
      password: "QA-production-only-453!",
    }),
  });
  assert.equal(response.status, 201);
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  console.log(
    "PASS production smoke: compiled page, API, HTTPS security headers and secure session cookie",
  );
} catch (error) {
  console.error(error);
  console.error(log);
  process.exitCode = 1;
} finally {
  const exited = new Promise((r) => server.once("exit", r));
  server.kill("SIGTERM");
  await exited;
}
