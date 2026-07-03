/**
 * Shared helpers for API integration tests.
 */

import { config as loadEnv } from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "@businessos/kernel";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
loadEnv({ path: join(repoRoot, ".env") });

/** Pool pointed at the test database. */
export function testPool(): Pool {
  const url = process.env["DATABASE_URL_TEST"] ?? process.env["DATABASE_URL"];
  return createPool(url);
}

/**
 * Wipe the event log and restart the sequence, so each test sees a clean log.
 * TRUNCATE bypasses the row-level immutability trigger (which only guards
 * UPDATE/DELETE), keeping the append-only guarantee intact for real writes.
 */
export async function resetEvents(pool: Pool): Promise<void> {
  await pool.query("TRUNCATE TABLE events RESTART IDENTITY");
}

/** A fresh, valid company id for a test — avoids cross-test collisions. */
export function newCompanyId(): string {
  return crypto.randomUUID();
}
