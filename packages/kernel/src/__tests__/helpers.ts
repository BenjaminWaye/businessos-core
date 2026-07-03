/**
 * Shared helpers for integration tests.
 */

import { config as loadEnv } from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "../db.js";
import type { CommandDeps } from "../commands.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
loadEnv({ path: join(repoRoot, ".env") });

/** Pool pointed at the test database. */
export function testPool(): Pool {
  const url = process.env["DATABASE_URL_TEST"] ?? process.env["DATABASE_URL"];
  return createPool(url);
}

/**
 * Wipe the event log and restart the sequence, so each test sees a clean log
 * with sequence numbers starting from 1. TRUNCATE bypasses the row-level
 * immutability trigger (which only guards UPDATE/DELETE), keeping the
 * append-only guarantee intact for real writes.
 */
export async function resetEvents(pool: Pool): Promise<void> {
  await pool.query("TRUNCATE TABLE events RESTART IDENTITY");
}

/**
 * Deterministic command dependencies for golden tests: ids are sequential,
 * valid uuids (…0001, …0002, …) and time is fixed. Lets us assert exact event
 * output while satisfying the UUID column type.
 */
export function fixedDeps(now = "2026-01-01T00:00:00.000Z"): CommandDeps {
  let counter = 0;
  return {
    newId: () => {
      const n = (++counter).toString(16).padStart(12, "0");
      return `00000000-0000-4000-8000-${n}`;
    },
    now: () => now,
  };
}
