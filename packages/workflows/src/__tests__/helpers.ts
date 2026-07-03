/**
 * Shared helpers for workflow tests.
 */

import { config as loadEnv } from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, type Pool, type StoredEvent } from "@businessos/kernel";
import type { CommandDeps } from "../commands.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
loadEnv({ path: join(repoRoot, ".env") });

export function testPool(): Pool {
  const url = process.env["DATABASE_URL_TEST"] ?? process.env["DATABASE_URL"];
  return createPool(url);
}

export async function resetEvents(pool: Pool): Promise<void> {
  await pool.query("TRUNCATE TABLE events RESTART IDENTITY");
}

/** Deterministic ids/time for golden-output tests. */
export function fixedDeps(now = "2026-03-01T00:00:00.000Z"): CommandDeps {
  let counter = 0;
  return {
    newId: () => {
      const n = (++counter).toString(16).padStart(12, "0");
      return `00000000-0000-4000-8000-${n}`;
    },
    now: () => now,
  };
}

/** Build a synthetic StoredEvent for pure engine tests, without touching the DB. */
export function fakeEvent(
  overrides: Partial<StoredEvent> & Pick<StoredEvent, "type" | "payload">,
): StoredEvent {
  return {
    seq: overrides.seq ?? 1,
    id: overrides.id ?? "evt-1",
    companyId: overrides.companyId ?? "acme",
    occurredAt: overrides.occurredAt ?? "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}
