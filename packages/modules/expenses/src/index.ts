/**
 * @businessos/expenses — public surface.
 *
 * Employee expense claims: submit -> approve -> reimburse, mirroring the
 * kernel's Bill/BillPayment lifecycle. Built entirely on the kernel's public
 * API (EventStore, EventDraft, StoredEvent) — the kernel has no idea this
 * module exists, same as accounting-se and workflows.
 */

export type {
  ExpenseClaim,
  ExpenseClaimStatus,
  ExpenseClaimSubmitted,
  ExpenseClaimApproved,
  ExpenseReimbursement,
  ExpenseReimbursementRegistered,
  ExpensesState,
  ExpensesEventMap,
  ExpensesEventType,
} from "./types.js";
export { initialExpensesState } from "./types.js";

export { projectExpenses } from "./projection.js";
export { replayExpenses } from "./replay.js";

export type {
  CommandDeps,
  SubmitExpenseClaimInput,
  ApproveExpenseClaimInput,
  RegisterExpenseReimbursementInput,
} from "./commands.js";
export { defaultDeps, submitExpenseClaim, approveExpenseClaim, registerExpenseReimbursement } from "./commands.js";
