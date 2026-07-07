/**
 * Command -> event pipeline for expense claims. Same shape as the kernel's
 * Bill commands: pure functions, no DB access; commands that need to
 * validate a transition take the current entity (loaded by the caller via
 * replay) rather than re-deriving it.
 */

import { randomUUID } from "node:crypto";
import type { EventDraft } from "@businessos/kernel";
import type {
  ExpenseClaim,
  ExpenseClaimApproved,
  ExpenseClaimSubmitted,
  ExpenseReimbursementRegistered,
} from "./types.js";

export interface CommandDeps {
  newId: () => string;
  now: () => string;
}

export function defaultDeps(): CommandDeps {
  return { newId: () => randomUUID(), now: () => new Date().toISOString() };
}

export interface SubmitExpenseClaimInput {
  companyId: string;
  claimantName: string;
  claimantEmail?: string | null;
  description: string;
  amount: number;
  currency?: string;
}

/** SubmitExpenseClaim -> ExpenseClaimSubmitted. */
export function submitExpenseClaim(
  input: SubmitExpenseClaimInput,
  deps: CommandDeps,
): EventDraft<ExpenseClaimSubmitted> {
  if (!input.claimantName?.trim()) {
    throw new Error("submitExpenseClaim: claimantName is required");
  }
  if (!input.description?.trim()) {
    throw new Error("submitExpenseClaim: description is required");
  }
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error("submitExpenseClaim: amount must be a positive integer (minor units)");
  }

  return {
    id: deps.newId(),
    companyId: input.companyId,
    type: "ExpenseClaimSubmitted",
    occurredAt: deps.now(),
    payload: {
      expenseClaimId: deps.newId(),
      claimantName: input.claimantName.trim(),
      claimantEmail: input.claimantEmail?.trim() || null,
      description: input.description.trim(),
      amount: input.amount,
      currency: input.currency ?? "SEK",
    },
  };
}

export interface ApproveExpenseClaimInput {
  companyId: string;
}

/**
 * ApproveExpenseClaim -> ExpenseClaimApproved.
 *
 * Rule: a claim must be `submitted` (not yet approved) to be approved.
 */
export function approveExpenseClaim(
  claim: ExpenseClaim,
  input: ApproveExpenseClaimInput,
  deps: CommandDeps,
): EventDraft<ExpenseClaimApproved> {
  if (claim.status !== "submitted") {
    throw new Error(
      `approveExpenseClaim: claim ${claim.id} is "${claim.status}", must be "submitted" to approve`,
    );
  }

  return {
    id: deps.newId(),
    companyId: input.companyId,
    type: "ExpenseClaimApproved",
    occurredAt: deps.now(),
    payload: { expenseClaimId: claim.id },
  };
}

export interface RegisterExpenseReimbursementInput {
  companyId: string;
  /** Amount in minor currency units. Must be a positive integer. */
  amount: number;
}

/**
 * RegisterExpenseReimbursement -> ExpenseReimbursementRegistered.
 *
 * Rules (enforced against the current claim, loaded by the caller):
 *   - the claim must already be approved (`submitted` is rejected)
 *   - the claim must not already be fully reimbursed
 *   - the reimbursement cannot exceed the remaining balance
 */
export function registerExpenseReimbursement(
  claim: ExpenseClaim,
  input: RegisterExpenseReimbursementInput,
  deps: CommandDeps,
): EventDraft<ExpenseReimbursementRegistered> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error("registerExpenseReimbursement: amount must be a positive integer (minor units)");
  }
  if (claim.status === "submitted") {
    throw new Error(`registerExpenseReimbursement: claim ${claim.id} has not been approved yet`);
  }
  if (claim.status === "reimbursed") {
    throw new Error(`registerExpenseReimbursement: claim ${claim.id} is already fully reimbursed`);
  }
  const remaining = claim.amount - claim.amountReimbursed;
  if (input.amount > remaining) {
    throw new Error(
      `registerExpenseReimbursement: reimbursement of ${input.amount} exceeds remaining balance ${remaining} on claim ${claim.id}`,
    );
  }

  return {
    id: deps.newId(),
    companyId: input.companyId,
    type: "ExpenseReimbursementRegistered",
    occurredAt: deps.now(),
    payload: {
      reimbursementId: deps.newId(),
      expenseClaimId: claim.id,
      amount: input.amount,
      currency: claim.currency,
    },
  };
}
