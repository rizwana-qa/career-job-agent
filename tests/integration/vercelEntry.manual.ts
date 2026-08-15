/**
 * Local verification that the Vercel serverless entry point actually serves
 * requests. This is NOT run by `npm test` — it's a deployment-readiness
 * smoke check, same category as the other tests/integration/*.manual.ts
 * scripts (excluded from Vitest's `tests/**\/*.test.ts` glob).
 *
 * There is no separate api/index.ts anymore: per Vercel's own current,
 * documented zero-config Express support
 * (https://vercel.com/docs/frameworks/backend/express), src/index.ts — the
 * same file used for local dev — IS the Vercel entry point. Vercel detects
 * it by file location (src/index.ts) and export shape (the app.listen()
 * "port listener" pattern, which this file already uses), with no
 * vercel.json required.
 *
 * This script runs that exact file (src/index.ts) as a real child process —
 * the same way `npm run dev` and Vercel itself run it — and confirms the
 * server actually answers requests, then terminates the child process.
 * (Importing it in-process instead of spawning it was tried first, but
 * force-exiting a process that still holds an open http.Server handle
 * crashes Node's libuv layer on Windows — spawning a separate process and
 * killing that avoids the problem entirely and is arguably more faithful:
 * it's the literal command Vercel/`npm run dev` would run.)
 *
 * Usage:
 *   npm run verify:vercel
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../src/config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const entryPoint = path.join(projectRoot, "src", "index.ts");
// Spawn tsx's own CLI script (.mjs) via `node` directly, rather than the
// node_modules/.bin/tsx(.cmd) shim — on Windows, spawning a .cmd file
// without a shell fails with EINVAL, and this sidesteps that entirely.
const tsxCli = path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");

const BASE_URL = `http://localhost:${env.port}`;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(`Starting the Vercel entry point (src/index.ts) as a child process: node ${tsxCli} ${entryPoint}`);
  const child = spawn(process.execPath, [tsxCli, entryPoint], { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] });

  let started = false;
  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (text.includes("listening on port")) {
      started = true;
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
  });

  let exitCode = 1;
  try {
    // Wait up to 5s for the "listening" log line rather than a fixed delay.
    for (let waited = 0; waited < 5000 && !started; waited += 100) {
      await delay(100);
    }
    if (!started) {
      throw new Error("Entry point did not report 'listening on port' within 5s");
    }

    const health = await fetch(`${BASE_URL}/health`);
    const healthBody = await health.json();
    console.log(`GET /health -> ${health.status} ${JSON.stringify(healthBody)}`);

    const careerRun = await fetch(`${BASE_URL}/career/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const careerRunBody = await careerRun.json();
    console.log(`POST /career/run (no Authorization header) -> ${careerRun.status} ${JSON.stringify(careerRunBody)}`);

    const healthOk = health.status === 200 && healthBody?.status === "ok";
    // Without CAREER_AGENT_API_KEY configured in this shell, the route fails
    // closed with 503; with it configured, an unauthenticated request must
    // get 401 — either way, "200" here would mean auth was bypassed.
    const authIntact = careerRun.status === 503 || careerRun.status === 401;

    if (healthOk && authIntact) {
      console.log("PASS: the Vercel entry point (src/index.ts) serves GET /health (200) and POST /career/run stays authenticated.");
      exitCode = 0;
    } else {
      console.error("FAIL: the Vercel entry point did not behave as expected — see output above.");
    }
  } catch (error) {
    console.error("Vercel entry point verification failed:", error instanceof Error ? error.message : error);
  } finally {
    child.kill();
  }

  process.exitCode = exitCode;
}

main();
