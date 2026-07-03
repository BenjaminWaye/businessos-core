/**
 * Event store integration test.
 *
 * Proves: events can be inserted and fetched per company in canonical order,
 * and that the log is genuinely immutable (UPDATE/DELETE rejected by the DB).
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { EventStore } from "../event-store.js";
import { createCustomer } from "../commands.js";
import type { Pool } from "../db.js";
import { fixedDeps, resetEvents, testPool } from "./helpers.js";

const pool: Pool = testPool();
const store = new EventStore(pool);

beforeEach(() => resetEvents(pool));
afterAll(() => pool.end());

const COMPANY = "00000000-0000-0000-0000-000000000001";
const OTHER = "00000000-0000-0000-0000-000000000002";

describe("EventStore.append / byCompany", () => {
  it("inserts an event and assigns a sequence number", async () => {
    const deps = fixedDeps();
    const [stored] = await store.append([
      createCustomer({ companyId: COMPANY, name: "Ada" }, deps),
    ]);

    expect(stored!.seq).toBe(1);
    expect(stored!.type).toBe("CustomerCreated");

    const fetched = await store.byCompany(COMPANY);
    expect(fetched).toHaveLength(1);
    expect(fetched[0]!.payload).toMatchObject({ name: "Ada" });
  });

  it("assigns contiguous, increasing sequence numbers", async () => {
    const deps = fixedDeps();
    const stored = await store.append([
      createCustomer({ companyId: COMPANY, name: "Ada" }, deps),
      createCustomer({ companyId: COMPANY, name: "Grace" }, deps),
      createCustomer({ companyId: COMPANY, name: "Linus" }, deps),
    ]);
    expect(stored.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("isolates events by company", async () => {
    const deps = fixedDeps();
    await store.append([createCustomer({ companyId: COMPANY, name: "Ada" }, deps)]);
    await store.append([createCustomer({ companyId: OTHER, name: "Grace" }, deps)]);

    const ours = await store.byCompany(COMPANY);
    expect(ours).toHaveLength(1);
    expect(ours[0]!.payload).toMatchObject({ name: "Ada" });
  });

  it("rejects UPDATE — the log is append-only", async () => {
    await store.append([
      createCustomer({ companyId: COMPANY, name: "Ada" }, fixedDeps()),
    ]);
    await expect(
      pool.query("UPDATE events SET type = 'Tampered' WHERE company_id = $1", [
        COMPANY,
      ]),
    ).rejects.toThrow(/append-only/);
  });

  it("rejects DELETE — the log is append-only", async () => {
    await store.append([
      createCustomer({ companyId: COMPANY, name: "Ada" }, fixedDeps()),
    ]);
    await expect(
      pool.query("DELETE FROM events WHERE company_id = $1", [COMPANY]),
    ).rejects.toThrow(/append-only/);
  });
});
