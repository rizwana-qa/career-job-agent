/**
 * Local verification that the Vercel serverless entry point actually serves
 * requests. This is NOT run by `npm test` — it's a deployment-readiness
 * smoke check, same category as the other tests/integration/*.manual.ts
 * scripts (excluded from Vitest's `tests/**\/*.test.ts` glob).
 *
 * api/index.ts is what Vercel actually deploys (see docs/DEPLOYMENT.md for
 * why this project uses the explicit /api Serverless Function convention
 * rather than Vercel's newer zero-config Express detection). It exports the
 * Express app directly with no app.listen() call, so it can be imported
 * in-process and driven with Supertest — no child process, no open port,
 * no server to shut down afterward.
 *
 * Usage:
 *   npm run verify:vercel
 */
import request from "supertest";
import app from "../../api/index.js";

async function main() {
  const health = await request(app).get("/health");
  console.log(`GET /health -> ${health.status} ${JSON.stringify(health.body)}`);

  const careerRun = await request(app).post("/career/run").send({});
  console.log(`POST /career/run (no Authorization header) -> ${careerRun.status} ${JSON.stringify(careerRun.body)}`);

  const healthOk = health.status === 200 && health.body?.status === "ok";
  // Without CAREER_AGENT_API_KEY configured in this shell, the route fails
  // closed with 503; with it configured, an unauthenticated request must
  // get 401 — either way, "200" here would mean auth was bypassed.
  const authIntact = careerRun.status === 503 || careerRun.status === 401;

  if (healthOk && authIntact) {
    console.log("PASS: the Vercel entry point (api/index.ts) serves GET /health (200) and POST /career/run stays authenticated.");
    process.exitCode = 0;
  } else {
    console.error("FAIL: the Vercel entry point did not behave as expected — see output above.");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Vercel entry point verification failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
