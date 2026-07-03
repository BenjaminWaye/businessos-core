/**
 * Projection determinism (pure — no database).
 *
 * Proves: same events + same `asOf` in -> same state out, and that folding
 * genuinely derives state from events (create + update).
 */

import { describe, expect, it } from "vitest";
import { project } from "../projection.js";
import { createCustomer, updateCustomer } from "../commands.js";
import type { EventDraft, StoredEvent } from "../types.js";
import { fixedDeps } from "./helpers.js";

const ASOF = "2026-06-01T00:00:00.000Z";

/** Turn drafts into stored events with sequential seq numbers (1-based). */
function asStored(drafts: readonly EventDraft[]): StoredEvent[] {
  return drafts.map((d, i) => ({ ...d, seq: i + 1 }));
}

describe("project", () => {
  it("derives customer state from a create event", () => {
    const deps = fixedDeps();
    const created = createCustomer({ companyId: "acme", name: "Ada" }, deps);
    const state = project(asStored([created]), ASOF);

    expect(state.customers).toEqual([
      {
        id: created.payload.customerId,
        name: "Ada",
        email: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("folds a later update onto the existing customer", () => {
    const deps = fixedDeps();
    const created = createCustomer(
      { companyId: "acme", name: "Ada", email: "ada@acme.test" },
      deps,
    );
    const customerId = created.payload.customerId;
    const updated = updateCustomer(
      { companyId: "acme", customerId, name: "Ada Lovelace" },
      deps,
    );

    const state = project(asStored([created, updated]), ASOF);

    expect(state.customers).toHaveLength(1);
    expect(state.customers[0]).toMatchObject({
      id: customerId,
      name: "Ada Lovelace",
      email: "ada@acme.test",
    });
  });

  it("a partial update only touches the given fields", () => {
    const deps = fixedDeps();
    const created = createCustomer(
      { companyId: "acme", name: "Ada", email: "ada@acme.test" },
      deps,
    );
    const customerId = created.payload.customerId;
    const updated = updateCustomer(
      { companyId: "acme", customerId, email: "ada.lovelace@acme.test" },
      deps,
    );

    const state = project(asStored([created, updated]), ASOF);
    expect(state.customers[0]).toMatchObject({
      name: "Ada",
      email: "ada.lovelace@acme.test",
    });
  });

  it("is deterministic: same events + same asOf always produce the same state", () => {
    const deps = fixedDeps();
    const events = asStored([
      createCustomer({ companyId: "acme", name: "Ada" }, deps),
      createCustomer({ companyId: "acme", name: "Grace" }, deps),
    ]);

    expect(project(events, ASOF)).toEqual(project(events, ASOF));
  });

  it("ignores unknown event types rather than failing", () => {
    const events = asStored([
      {
        id: "x",
        companyId: "acme",
        type: "SomethingUnknown",
        occurredAt: "2026-01-01T00:00:00.000Z",
        payload: {},
      },
    ]);
    expect(project(events, ASOF).customers).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const deps = fixedDeps();
    const events = asStored([
      createCustomer({ companyId: "acme", name: "B" }, deps),
      createCustomer({ companyId: "acme", name: "A" }, deps),
    ]);
    const snapshot = events.map((e) => e.id);
    project(events, ASOF);
    expect(events.map((e) => e.id)).toEqual(snapshot);
  });
});

describe("commands", () => {
  it("createCustomer rejects an empty name", () => {
    expect(() =>
      createCustomer({ companyId: "acme", name: "   " }, fixedDeps()),
    ).toThrow(/name is required/);
  });

  it("createCustomer produces a CustomerCreated draft", () => {
    const draft = createCustomer({ companyId: "acme", name: "Ada" }, fixedDeps());
    expect(draft.type).toBe("CustomerCreated");
    expect(draft.companyId).toBe("acme");
    expect(draft.payload.name).toBe("Ada");
  });

  it("updateCustomer rejects an empty patch", () => {
    expect(() =>
      updateCustomer({ companyId: "acme", customerId: "c1" }, fixedDeps()),
    ).toThrow(/nothing to update/);
  });
});
