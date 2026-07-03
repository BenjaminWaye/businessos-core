/**
 * Command -> Event pipeline.
 *
 * Commands are the only write interface to the kernel. Each command is a pure
 * function that validates its input and produces one or more event drafts. It
 * does NOT touch the database — persistence is a separate step (the event
 * store). This keeps commands trivially testable.
 *
 * The non-deterministic bits a command needs (a fresh id, the current time) are
 * injected as `CommandDeps`. Production wires these to `crypto.randomUUID` and
 * the system clock; tests inject fixed values to get golden output. Note this
 * does not threaten replay determinism: the randomness happens once at write
 * time, and replay reads the persisted events, never re-running the command.
 *
 * Some commands (sendInvoice, registerPayment) enforce state-transition rules
 * that depend on the *current* aggregate. Since commands have no database
 * access, the caller is responsible for loading the relevant entity (via
 * `project`/`replayCompany`) and passing it in — the command only validates
 * and decides; it never fetches.
 */

import { randomUUID } from "node:crypto";
import type { EventDraft } from "./types.js";
import type {
  Bill,
  BillApproved,
  BillPaymentRegistered,
  BillReceived,
  CustomerCreated,
  CustomerUpdated,
  Invoice,
  InvoiceCreated,
  InvoiceSent,
  PaymentRegistered,
  SupplierCreated,
} from "./state.js";

export interface CommandDeps {
  /** Generate a fresh unique id (uuid). */
  newId: () => string;
  /** Current domain time as ISO 8601. */
  now: () => string;
}

/** Default dependencies: real uuid + real clock. */
export function defaultDeps(): CommandDeps {
  return {
    newId: () => randomUUID(),
    now: () => new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------

export interface CreateCustomerInput {
  companyId: string;
  name: string;
  email?: string | null;
}

/** CreateCustomer -> CustomerCreated. */
export function createCustomer(
  input: CreateCustomerInput,
  deps: CommandDeps,
): EventDraft<CustomerCreated> {
  const name = input.name.trim();
  if (name === "") throw new Error("createCustomer: name is required");

  return {
    id: deps.newId(),
    companyId: input.companyId,
    type: "CustomerCreated",
    occurredAt: deps.now(),
    payload: {
      customerId: deps.newId(),
      name,
      email: input.email?.trim() || null,
    },
  };
}

export interface UpdateCustomerInput {
  companyId: string;
  customerId: string;
  name?: string;
  email?: string | null;
}

/** UpdateCustomer -> CustomerUpdated (patch: omitted fields are unchanged). */
export function updateCustomer(
  input: UpdateCustomerInput,
  deps: CommandDeps,
): EventDraft<CustomerUpdated> {
  if (input.name !== undefined && input.name.trim() === "") {
    throw new Error("updateCustomer: name cannot be blank");
  }
  if (input.name === undefined && input.email === undefined) {
    throw new Error("updateCustomer: nothing to update");
  }

  return {
    id: deps.newId(),
    companyId: input.companyId,
    type: "CustomerUpdated",
    occurredAt: deps.now(),
    payload: {
      customerId: input.customerId,
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.email !== undefined ? { email: input.email?.trim() || null } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Supplier
// ---------------------------------------------------------------------------

export interface CreateSupplierInput {
  companyId: string;
  name: string;
  email?: string | null;
}

/** CreateSupplier -> SupplierCreated. */
export function createSupplier(
  input: CreateSupplierInput,
  deps: CommandDeps,
): EventDraft<SupplierCreated> {
  const name = input.name.trim();
  if (name === "") throw new Error("createSupplier: name is required");

  return {
    id: deps.newId(),
    companyId: input.companyId,
    type: "SupplierCreated",
    occurredAt: deps.now(),
    payload: {
      supplierId: deps.newId(),
      name,
      email: input.email?.trim() || null,
    },
  };
}

// ---------------------------------------------------------------------------
// Invoice
// ---------------------------------------------------------------------------

export interface CreateInvoiceInput {
  companyId: string;
  customerId: string;
  /** Amount in minor currency units (e.g. öre). Must be a positive integer. */
  amount: number;
  currency?: string;
  /** ISO 8601 due date. */
  dueDate: string;
}

/** CreateInvoice -> InvoiceCreated. Starts life as `draft`. */
export function createInvoice(
  input: CreateInvoiceInput,
  deps: CommandDeps,
): EventDraft<InvoiceCreated> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error("createInvoice: amount must be a positive integer (minor units)");
  }
  if (!input.dueDate) throw new Error("createInvoice: dueDate is required");

  return {
    id: deps.newId(),
    companyId: input.companyId,
    type: "InvoiceCreated",
    occurredAt: deps.now(),
    payload: {
      invoiceId: deps.newId(),
      customerId: input.customerId,
      amount: input.amount,
      currency: input.currency ?? "SEK",
      dueDate: input.dueDate,
    },
  };
}

export interface SendInvoiceInput {
  companyId: string;
}

/**
 * SendInvoice -> InvoiceSent.
 *
 * Rule: an invoice must be `draft` to be sent. Takes the current invoice
 * (loaded by the caller) so it can enforce that transition.
 */
export function sendInvoice(
  invoice: Invoice,
  input: SendInvoiceInput,
  deps: CommandDeps,
): EventDraft<InvoiceSent> {
  if (invoice.status !== "draft") {
    throw new Error(
      `sendInvoice: invoice ${invoice.id} is "${invoice.status}", must be "draft" to send`,
    );
  }

  return {
    id: deps.newId(),
    companyId: input.companyId,
    type: "InvoiceSent",
    occurredAt: deps.now(),
    payload: { invoiceId: invoice.id },
  };
}

// ---------------------------------------------------------------------------
// Payment
// ---------------------------------------------------------------------------

export interface RegisterPaymentInput {
  companyId: string;
  /** Amount in minor currency units. Must be a positive integer. */
  amount: number;
}

/**
 * RegisterPayment -> PaymentRegistered.
 *
 * Rules (enforced against the current invoice, loaded by the caller):
 *   - the invoice must already be sent (an "overdue" invoice was sent, so
 *     payment is still allowed; only `draft` is rejected)
 *   - the invoice must not already be fully paid
 *   - the payment cannot push the total paid past the invoice amount
 */
export function registerPayment(
  invoice: Invoice,
  input: RegisterPaymentInput,
  deps: CommandDeps,
): EventDraft<PaymentRegistered> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error("registerPayment: amount must be a positive integer (minor units)");
  }
  if (invoice.status === "draft") {
    throw new Error(
      `registerPayment: invoice ${invoice.id} has not been sent yet`,
    );
  }
  if (invoice.status === "paid") {
    throw new Error(`registerPayment: invoice ${invoice.id} is already fully paid`);
  }
  const remaining = invoice.amount - invoice.amountPaid;
  if (input.amount > remaining) {
    throw new Error(
      `registerPayment: payment of ${input.amount} exceeds remaining balance ${remaining} on invoice ${invoice.id}`,
    );
  }

  return {
    id: deps.newId(),
    companyId: input.companyId,
    type: "PaymentRegistered",
    occurredAt: deps.now(),
    payload: {
      paymentId: deps.newId(),
      invoiceId: invoice.id,
      amount: input.amount,
      currency: invoice.currency,
    },
  };
}

// ---------------------------------------------------------------------------
// Bill (accounts payable — a supplier invoice)
// ---------------------------------------------------------------------------

export interface ReceiveBillInput {
  companyId: string;
  supplierId: string;
  /** Amount in minor currency units (e.g. öre). Must be a positive integer. */
  amount: number;
  currency?: string;
  /** ISO 8601 due date. */
  dueDate: string;
}

/** ReceiveBill -> BillReceived. Starts life as `received`, pending approval. */
export function receiveBill(
  input: ReceiveBillInput,
  deps: CommandDeps,
): EventDraft<BillReceived> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error("receiveBill: amount must be a positive integer (minor units)");
  }
  if (!input.dueDate) throw new Error("receiveBill: dueDate is required");

  return {
    id: deps.newId(),
    companyId: input.companyId,
    type: "BillReceived",
    occurredAt: deps.now(),
    payload: {
      billId: deps.newId(),
      supplierId: input.supplierId,
      amount: input.amount,
      currency: input.currency ?? "SEK",
      dueDate: input.dueDate,
    },
  };
}

export interface ApproveBillInput {
  companyId: string;
}

/**
 * ApproveBill -> BillApproved.
 *
 * Rule: a bill must be `received` (not yet approved) to be approved. Takes
 * the current bill (loaded by the caller) so it can enforce that transition.
 */
export function approveBill(
  bill: Bill,
  input: ApproveBillInput,
  deps: CommandDeps,
): EventDraft<BillApproved> {
  if (bill.status !== "received") {
    throw new Error(
      `approveBill: bill ${bill.id} is "${bill.status}", must be "received" to approve`,
    );
  }

  return {
    id: deps.newId(),
    companyId: input.companyId,
    type: "BillApproved",
    occurredAt: deps.now(),
    payload: { billId: bill.id },
  };
}

export interface RegisterBillPaymentInput {
  companyId: string;
  /** Amount in minor currency units. Must be a positive integer. */
  amount: number;
}

/**
 * RegisterBillPayment -> BillPaymentRegistered.
 *
 * Rules (enforced against the current bill, loaded by the caller):
 *   - the bill must already be approved (an "overdue" bill was approved, so
 *     payment is still allowed; only `received` is rejected)
 *   - the bill must not already be fully paid
 *   - the payment cannot push the total paid past the bill amount
 */
export function registerBillPayment(
  bill: Bill,
  input: RegisterBillPaymentInput,
  deps: CommandDeps,
): EventDraft<BillPaymentRegistered> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error(
      "registerBillPayment: amount must be a positive integer (minor units)",
    );
  }
  if (bill.status === "received") {
    throw new Error(`registerBillPayment: bill ${bill.id} has not been approved yet`);
  }
  if (bill.status === "paid") {
    throw new Error(`registerBillPayment: bill ${bill.id} is already fully paid`);
  }
  const remaining = bill.amount - bill.amountPaid;
  if (input.amount > remaining) {
    throw new Error(
      `registerBillPayment: payment of ${input.amount} exceeds remaining balance ${remaining} on bill ${bill.id}`,
    );
  }

  return {
    id: deps.newId(),
    companyId: input.companyId,
    type: "BillPaymentRegistered",
    occurredAt: deps.now(),
    payload: {
      billPaymentId: deps.newId(),
      billId: bill.id,
      amount: input.amount,
      currency: bill.currency,
    },
  };
}
