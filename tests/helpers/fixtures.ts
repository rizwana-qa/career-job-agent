import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../fixtures/jobs");

export function loadAllJobFixtures(): unknown[] {
  const files = readdirSync(FIXTURES_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort();
  return files.map((file) => JSON.parse(readFileSync(path.join(FIXTURES_DIR, file), "utf-8")));
}

export function loadJobFixture(filename: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, filename), "utf-8"));
}
