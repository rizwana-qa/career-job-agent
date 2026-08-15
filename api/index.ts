import { createApp } from "../src/api/app.js";

/**
 * Vercel serverless entry point. Vercel's Node.js runtime invokes the
 * default export as a plain (req, res) request handler — an Express app
 * already has that exact shape, so it's exported as-is. No app.listen()
 * here: Vercel owns the HTTP server and process lifecycle, not this app
 * (see src/index.ts for the separate local-dev entry point, which does
 * call app.listen()). All routes (/health, /jobs/*, /career/run) are
 * defined once in src/api/app.ts and reused unchanged here.
 *
 * This uses the explicit /api Serverless Function convention rather than
 * Vercel's newer zero-config Express detection (which would otherwise pick
 * up src/index.ts directly) — that auto-detection currently crashes at
 * build time on this project with an internal Vercel error
 * ("Cannot read properties of undefined (reading 'fsPath')"), thrown by
 * Vercel's own build tooling before any project file is even processed.
 * See docs/DEPLOYMENT.md for the full history. Set the Vercel project's
 * Framework Preset to "Other" (not "Express") for this file to be used.
 */
const app = createApp();

export default app;
