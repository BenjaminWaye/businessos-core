/**
 * Replay test — THE core foundation proof of the kernel.
 *
 *   write events to DB -> rebuild state from scratch -> identical output
 *
 * State is never stored; it is always re-derived from the immutable log. These
 * tests prove that rebuilding is deterministic and reproducible, including for
 * the Milestone 2 invoice/payment domain (see invoice-lifecycle.test.ts for the
 * full lifecycle replay coverage).
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { EventStore } from "../event-store.js";
import { replayCompany } from "../replay.js";
import { project } from "../projection.js";
import { createCustomer, updateCustomer } from "../commands.js";
import type { Pool } from "../db.js";
import { fixedDeps, resetEvents, testPool } from "./helpers.js";

const pool: Pool = testPool();
const store = new EventStore(pool);

const ASOF = "2026-06-01T00:00:00.000Z";

beforeEach(() => resetEvents(pool));
afterAll(() => pool.end());

const COMPANY = "00000000-0000-0000-0000-000000000010";

/** Seed a small but non-trivial history and return the created customer id. */
async function seed(): Promise<string> {
  const deps = fixedDeps();
  const created = createCustomer(
    { companyId: COMPANY, name: "Ada", email: "ada@acme.test" },
    deps,
  );
  await store.append([created]);
  await store.append([
    createCustomer({ companyId: COMPANY, name: "Grace" }, deps),
  ]);
  await store.append([
    updateCustomer(
      { companyId: COMPANY, customerId: created.payload.customerId, name: "Ada L." },
      deps,
    ),
  ]);
  return created.payload.customerId;
}

describe("replay", () => {
  it("rebuilds the expected state from the DB log", async () => {
    const adaId = await seed();
    const state = await replayCompany(store, COMPANY, ASOF);

    expect(state.customers).toHaveLength(2);
    const ada = state.customers.find((c) => c.id === adaId);
    expect(ada).toMatchObject({ name: "Ada L.", email: "ada@acme.test" });
    expect(state.customers.some((c) => c.name === "Grace")).toBe(true);
  });

  it("is reproducible: replaying twice yields identical output", async () => {
    await seed();
    const first = await replayCompany(store, COMPANY, ASOF);
    const second = await replayCompany(store, COMPANY, ASOF);
    expect(second).toEqual(first);
  });

  it("matches projecting the fetched events directly", async () => {
    await seed();
    const events = await store.byCompany(COMPANY);
    expect(project(events, ASOF)).toEqual(await replayCompany(store, COMPANY, ASOF));
  });

  it("returns empty state for a company with no events", async () => {
    const state = await replayCompany(
      store,
      "ffffffff-0000-0000-0000-000000000000",
      ASOF,
    );
    expect(state.customers).toEqual([]);
  });
});
