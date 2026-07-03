/**
 * Vitest global setup: prepare the integration test database once per run.
 *
 * Loads .env, points the kernel at DATABASE_URL_TEST, and applies all
 * migrations so the `events` table (and its immutability trigger) exist.
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { createPool } from "../db.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");

export default async function setup(): Promise<void> {
  loadEnv({ path: join(repoRoot, ".env") });

  const testUrl = process.env["DATABASE_URL_TEST"];
  if (!testUrl) {
    throw new Error("DATABASE_URL_TEST must be set to run the test suite.");
  }
  // Make the test database the default for everything in this process.
  process.env["DATABASE_URL"] = testUrl;

  const pool = createPool(testUrl);
  try {
    const migrationsDir = join(repoRoot, "infrastructure", "migrations");
    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const sql = await readFile(join(migrationsDir, file), "utf8");
      await pool.query(sql);
    }
  } finally {
    await pool.end();
  }
}
