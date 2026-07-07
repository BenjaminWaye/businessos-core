/**
 * Projection engine for the expenses module: events -> ExpensesState.
 *
 * Pure and deterministic, same guarantees as the kernel's own `project()` and
 * accounting-se's `projectAccounting()`: canonical ordering (sorted by
 * global sequence before folding), ignores event types it doesn't
 * recognize. Operates on the same shared event log every other module reads.
 */

import { compareEvents, type StoredEvent } from "@businessos/kernel";
import {
  initialExpensesState,
  type ExpenseClaim,
  type ExpenseClaimApproved,
  type ExpenseClaimSubmitted,
  type ExpenseReimbursementRegistered,
  type ExpensesState,
} from "./types.js";

function apply(state: ExpensesState, event: StoredEvent): ExpensesState {
  switch (event.type) {
    case "ExpenseClaimSubmitted": {
      const p = event.payload as ExpenseClaimSubmitted;
      const claim: ExpenseClaim = {
        id: p.expenseClaimId,
        claimantName: p.claimantName,
        claimantEmail: p.claimantEmail,
        description: p.description,
        amount: p.amount,
        currency: p.currency,
        status: "submitted",
        amountReimbursed: 0,
        createdAt: event.occurredAt,
      };
      return { ...state, claims: [...state.claims, claim] };
    }

    case "ExpenseClaimApproved": {
      const p = event.payload as ExpenseClaimApproved;
      return {
        ...state,
        claims: state.claims.map((c) => (c.id === p.expenseClaimId ? { ...c, status: "approved" } : c)),
      };
    }

    case "ExpenseReimbursementRegistered": {
      const p = event.payload as ExpenseReimbursementRegistered;
      return {
        ...state,
        reimbursements: [
          ...state.reimbursements,
          {
            id: p.reimbursementId,
            expenseClaimId: p.expenseClaimId,
            amount: p.amount,
            currency: p.currency,
            registeredAt: event.occurredAt,
          },
        ],
        claims: state.claims.map((c) => {
          if (c.id !== p.expenseClaimId) return c;
          const amountReimbursed = c.amountReimbursed + p.amount;
          return {
            ...c,
            amountReimbursed,
            status: amountReimbursed >= c.amount ? "reimbursed" : "partially_reimbursed",
          };
        }),
      };
    }

    // Non-expenses events (e.g. CustomerCreated, VerificationCreated) are
    // ignored, not an error — this log is shared with every other module.
    default:
      return state;
  }
}

export function projectExpenses(events: readonly StoredEvent[]): ExpensesState {
  return [...events].sort(compareEvents).reduce(apply, initialExpensesState());
}
