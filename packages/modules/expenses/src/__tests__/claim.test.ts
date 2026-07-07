/**
 * Expense claim command/projection tests (pure — no database).
 *
 * Covers the lifecycle rules mirrored from the kernel's Bill/BillPayment:
 * submit -> approve -> reimburse (fully or partially), and the transitions
 * each command rejects.
 */

import { describe, expect, it } from "vitest";
import type { EventDraft, StoredEvent } from "@businessos/kernel";
import { projectExpenses } from "../projection.js";
import { approveExpenseClaim, registerExpenseReimbursement, submitExpenseClaim } from "../commands.js";
import type { ExpensesState } from "../types.js";
import { fixedDeps } from "./helpers.js";

const COMPANY = "acme";

function fold(drafts: EventDraft[]): ExpensesState {
  const stored: StoredEvent[] = drafts.map((d, i) => ({ ...d, seq: i + 1 }));
  return projectExpenses(stored);
}

describe("submitExpenseClaim", () => {
  it("submits a claim", () => {
    const draft = submitExpenseClaim(
      { companyId: COMPANY, claimantName: "Ada Lovelace", description: "Taxi to client meeting", amount: 25000 },
      fixedDeps(),
    );
    const state = fold([draft]);
    expect(state.claims).toEqual([
      expect.objectContaining({
        claimantName: "Ada Lovelace",
        description: "Taxi to client meeting",
        amount: 25000,
        currency: "SEK",
        status: "submitted",
        amountReimbursed: 0,
      }),
    ]);
  });

  it("rejects a missing claimant name", () => {
    expect(() =>
      submitExpenseClaim({ companyId: COMPANY, claimantName: "", description: "Taxi", amount: 100 }, fixedDeps()),
    ).toThrow(/claimantName is required/);
  });

  it("rejects a missing description", () => {
    expect(() =>
      submitExpenseClaim({ companyId: COMPANY, claimantName: "Ada", description: "  ", amount: 100 }, fixedDeps()),
    ).toThrow(/description is required/);
  });

  it("rejects a non-positive amount", () => {
    expect(() =>
      submitExpenseClaim({ companyId: COMPANY, claimantName: "Ada", description: "Taxi", amount: 0 }, fixedDeps()),
    ).toThrow(/positive integer/);
  });
});

describe("approveExpenseClaim", () => {
  it("approves a submitted claim", () => {
    const submitted = submitExpenseClaim(
      { companyId: COMPANY, claimantName: "Ada", description: "Taxi", amount: 10000 },
      fixedDeps(),
    );
    const state = fold([submitted]);
    const approved = approveExpenseClaim(state.claims[0]!, { companyId: COMPANY }, fixedDeps());
    expect(fold([submitted, approved]).claims[0]).toMatchObject({ status: "approved" });
  });

  it("rejects approving a claim that isn't submitted", () => {
    const submitted = submitExpenseClaim(
      { companyId: COMPANY, claimantName: "Ada", description: "Taxi", amount: 10000 },
      fixedDeps(),
    );
    const state = fold([submitted]);
    const approved = approveExpenseClaim(state.claims[0]!, { companyId: COMPANY }, fixedDeps());
    const stateAfterApproval = fold([submitted, approved]);
    expect(() => approveExpenseClaim(stateAfterApproval.claims[0]!, { companyId: COMPANY }, fixedDeps())).toThrow(
      /must be "submitted" to approve/,
    );
  });
});

describe("registerExpenseReimbursement", () => {
  function approvedClaim() {
    const submitted = submitExpenseClaim(
      { companyId: COMPANY, claimantName: "Ada", description: "Taxi", amount: 10000 },
      fixedDeps(),
    );
    const state = fold([submitted]);
    const approved = approveExpenseClaim(state.claims[0]!, { companyId: COMPANY }, fixedDeps());
    return { submitted, approved, state: fold([submitted, approved]) };
  }

  it("rejects reimbursing a claim that hasn't been approved", () => {
    const submitted = submitExpenseClaim(
      { companyId: COMPANY, claimantName: "Ada", description: "Taxi", amount: 10000 },
      fixedDeps(),
    );
    const state = fold([submitted]);
    expect(() =>
      registerExpenseReimbursement(state.claims[0]!, { companyId: COMPANY, amount: 5000 }, fixedDeps()),
    ).toThrow(/has not been approved yet/);
  });

  it("partially reimburses, then fully reimburses", () => {
    const { submitted, approved, state } = approvedClaim();
    const partial = registerExpenseReimbursement(state.claims[0]!, { companyId: COMPANY, amount: 4000 }, fixedDeps());
    const afterPartial = fold([submitted, approved, partial]);
    expect(afterPartial.claims[0]).toMatchObject({ status: "partially_reimbursed", amountReimbursed: 4000 });

    const rest = registerExpenseReimbursement(afterPartial.claims[0]!, { companyId: COMPANY, amount: 6000 }, fixedDeps());
    const afterFull = fold([submitted, approved, partial, rest]);
    expect(afterFull.claims[0]).toMatchObject({ status: "reimbursed", amountReimbursed: 10000 });
  });

  it("rejects a reimbursement exceeding the remaining balance", () => {
    const { state } = approvedClaim();
    expect(() =>
      registerExpenseReimbursement(state.claims[0]!, { companyId: COMPANY, amount: 20000 }, fixedDeps()),
    ).toThrow(/exceeds remaining balance/);
  });

  it("rejects reimbursing an already fully reimbursed claim", () => {
    const { submitted, approved, state } = approvedClaim();
    const full = registerExpenseReimbursement(state.claims[0]!, { companyId: COMPANY, amount: 10000 }, fixedDeps());
    const afterFull = fold([submitted, approved, full]);
    expect(() =>
      registerExpenseReimbursement(afterFull.claims[0]!, { companyId: COMPANY, amount: 1 }, fixedDeps()),
    ).toThrow(/already fully reimbursed/);
  });
});
