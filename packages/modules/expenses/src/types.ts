/**
 * Employee expense claims — modeled directly on the kernel's Bill/BillPayment
 * shape (claim -> approve -> reimburse), since "money we owe someone for
 * something they paid for" is the same lifecycle whether the someone is a
 * supplier or a claimant. Lives in its own module (not the kernel) because,
 * unlike Bill, it isn't core business truth every company needs — it's a
 * pluggable capability, same as accounting-se and workflows.
 *
 * There is deliberately no Employee entity here: that's Payroll's domain,
 * not built yet. A claimant is just a name/email until Payroll exists to
 * link claims to.
 */

export type ExpenseClaimStatus = "submitted" | "approved" | "partially_reimbursed" | "reimbursed";

export interface ExpenseClaim {
  id: string;
  claimantName: string;
  claimantEmail: string | null;
  description: string;
  /** Minor currency units (öre), to avoid float rounding — same convention as Invoice/Bill. */
  amount: number;
  currency: string;
  status: ExpenseClaimStatus;
  amountReimbursed: number;
  createdAt: string;
}

export interface ExpenseClaimSubmitted {
  expenseClaimId: string;
  claimantName: string;
  claimantEmail: string | null;
  description: string;
  amount: number;
  currency: string;
}

export interface ExpenseClaimApproved {
  expenseClaimId: string;
}

export interface ExpenseReimbursement {
  id: string;
  expenseClaimId: string;
  amount: number;
  currency: string;
  registeredAt: string;
}

export interface ExpenseReimbursementRegistered {
  reimbursementId: string;
  expenseClaimId: string;
  amount: number;
  currency: string;
}

export interface ExpensesState {
  claims: ExpenseClaim[];
  reimbursements: ExpenseReimbursement[];
}

export function initialExpensesState(): ExpensesState {
  return { claims: [], reimbursements: [] };
}

export interface ExpensesEventMap {
  ExpenseClaimSubmitted: ExpenseClaimSubmitted;
  ExpenseClaimApproved: ExpenseClaimApproved;
  ExpenseReimbursementRegistered: ExpenseReimbursementRegistered;
}

export type ExpensesEventType = keyof ExpensesEventMap;
