/**
 * Replay test (DB-backed) — proves the full loop against real Postgres:
 * commands -> append -> event log -> replayExpenses -> identical state.
 * Same architectural claim accounting-se's posting.test.ts and workflows'
 * replay.test.ts make for their own domains.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { EventStore, type Pool } from "@businessos/kernel";
import { submitExpenseClaim, approveExpenseClaim, registerExpenseReimbursement, defaultDeps } from "../commands.js";
import { replayExpenses } from "../replay.js";
import { resetEvents, testPool } from "./helpers.js";

const pool: Pool = testPool();
const store = new EventStore(pool);

beforeEach(() => resetEvents(pool));
afterAll(() => pool.end());

const COMPANY = "00000000-0000-0000-0000-000000000060";

describe("replayExpenses", () => {
  it("rebuilds a claim through submit -> approve -> reimburse from the event log", async () => {
    const deps = defaultDeps();

    const submitDraft = submitExpenseClaim(
      { companyId: COMPANY, claimantName: "Ada Lovelace", description: "Conference travel", amount: 150000 },
      deps,
    );
    const [submitted] = await store.append([submitDraft]);

    let state = await replayExpenses(store, COMPANY);
    expect(state.claims).toHaveLength(1);
    expect(state.claims[0]).toMatchObject({ status: "submitted", amount: 150000 });

    const approveDraft = approveExpenseClaim(state.claims[0]!, { companyId: COMPANY }, deps);
    await store.append([approveDraft]);

    state = await replayExpenses(store, COMPANY);
    expect(state.claims[0]).toMatchObject({ status: "approved" });

    const reimburseDraft = registerExpenseReimbursement(state.claims[0]!, { companyId: COMPANY, amount: 150000 }, deps);
    await store.append([reimburseDraft]);

    state = await replayExpenses(store, COMPANY);
    expect(state.claims[0]).toMatchObject({ status: "reimbursed", amountReimbursed: 150000 });
    expect(state.reimbursements).toHaveLength(1);
    expect(submitted!.type).toBe("ExpenseClaimSubmitted");
  });

  it("keeps companies isolated", async () => {
    const deps = defaultDeps();
    const otherCompany = "00000000-0000-0000-0000-000000000061";

    await store.append([
      submitExpenseClaim({ companyId: COMPANY, claimantName: "Ada", description: "Taxi", amount: 1000 }, deps),
    ]);
    await store.append([
      submitExpenseClaim({ companyId: otherCompany, claimantName: "Bob", description: "Hotel", amount: 2000 }, deps),
    ]);

    const state = await replayExpenses(store, COMPANY);
    expect(state.claims).toHaveLength(1);
    expect(state.claims[0]!.claimantName).toBe("Ada");
  });
});
