/**
 * Milestone 2 business state and its events.
 *
 * Core business domain on top of the M1 kernel: customers, suppliers,
 * invoices, payments. Still no accounting (BAS/VAT), workflows, or AI — this
 * proves the kernel can model real business processes, nothing more.
 *
 * None of these entities are stored directly. They are reconstructed by
 * folding events through the projection engine (see projection.ts).
 */

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------

export interface Customer {
  id: string;
  name: string;
  email: string | null;
  /** Domain time the customer was created (ISO 8601), from the event. */
  createdAt: string;
}

export interface CustomerCreated {
  customerId: string;
  name: string;
  email: string | null;
}

/** Patch-style update: omitted fields are left unchanged. */
export interface CustomerUpdated {
  customerId: string;
  name?: string;
  email?: string | null;
}

// ---------------------------------------------------------------------------
// Supplier
// ---------------------------------------------------------------------------

export interface Supplier {
  id: string;
  name: string;
  email: string | null;
  createdAt: string;
}

export interface SupplierCreated {
  supplierId: string;
  name: string;
  email: string | null;
}

// ---------------------------------------------------------------------------
// Invoice
// ---------------------------------------------------------------------------

/**
 * `draft` | `sent` | `partially_paid` | `paid` are persisted base statuses,
 * folded directly from events. `overdue` is NOT persisted anywhere — it is
 * derived at read time by `project()` from `dueDate` vs. the `asOf` time the
 * caller supplies (see projection.ts). This is a deliberate decision: time
 * passing is not an event, so "this invoice became overdue" must never be
 * written to the log.
 */
export type InvoiceStatus = "draft" | "sent" | "partially_paid" | "paid" | "overdue";

export interface Invoice {
  id: string;
  customerId: string;
  /** Amount in minor currency units (e.g. öre), to avoid float rounding. */
  amount: number;
  currency: string;
  /** ISO 8601 date the invoice is due. */
  dueDate: string;
  status: InvoiceStatus;
  /** Sum of all registered payments, in minor units. Derived from PaymentRegistered events. */
  amountPaid: number;
  createdAt: string;
}

export interface InvoiceCreated {
  invoiceId: string;
  customerId: string;
  amount: number;
  currency: string;
  dueDate: string;
}

export interface InvoiceSent {
  invoiceId: string;
}

// ---------------------------------------------------------------------------
// Payment (against a sales Invoice — money coming IN from a customer)
// ---------------------------------------------------------------------------

export interface Payment {
  id: string;
  invoiceId: string;
  amount: number;
  /** Snapshotted from the invoice at the moment of payment (see registerPayment). */
  currency: string;
  registeredAt: string;
}

export interface PaymentRegistered {
  paymentId: string;
  invoiceId: string;
  amount: number;
  currency: string;
}

// ---------------------------------------------------------------------------
// Bill (accounts payable — a supplier invoice; money going OUT to a supplier)
// ---------------------------------------------------------------------------

/**
 * A Bill is deliberately a separate entity from Invoice, not "Invoice with a
 * direction flag". Accounts receivable and accounts payable are genuinely
 * different processes: you *send* an invoice but *receive* a bill, and a bill
 * needs internal approval before it's payable — there's no equivalent "send"
 * step. Sharing one polymorphic type would blur that and make the Swedish
 * accounting module's VAT handling (input vs. output VAT differs) harder to
 * reason about later.
 *
 * `received` | `approved` | `partially_paid` | `paid` are persisted base
 * statuses. `overdue` is derived at read time, exactly like Invoice — never
 * persisted as an event.
 */
export type BillStatus = "received" | "approved" | "partially_paid" | "paid" | "overdue";

export interface Bill {
  id: string;
  supplierId: string;
  /** Amount in minor currency units (e.g. öre), to avoid float rounding. */
  amount: number;
  currency: string;
  /** ISO 8601 date the bill is due. */
  dueDate: string;
  status: BillStatus;
  /** Sum of all registered bill payments, in minor units. */
  amountPaid: number;
  createdAt: string;
}

export interface BillReceived {
  billId: string;
  supplierId: string;
  amount: number;
  currency: string;
  dueDate: string;
}

export interface BillApproved {
  billId: string;
}

export interface BillPayment {
  id: string;
  billId: string;
  amount: number;
  currency: string;
  registeredAt: string;
}

export interface BillPaymentRegistered {
  billPaymentId: string;
  billId: string;
  amount: number;
  currency: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface State {
  customers: Customer[];
  suppliers: Supplier[];
  invoices: Invoice[];
  payments: Payment[];
  bills: Bill[];
  billPayments: BillPayment[];
}

export function initialState(): State {
  return {
    customers: [],
    suppliers: [],
    invoices: [],
    payments: [],
    bills: [],
    billPayments: [],
  };
}

/**
 * Map of event type -> payload, so the projection can be exhaustively typed.
 * New domain events get added here.
 */
export interface DomainEventMap {
  CustomerCreated: CustomerCreated;
  CustomerUpdated: CustomerUpdated;
  SupplierCreated: SupplierCreated;
  InvoiceCreated: InvoiceCreated;
  InvoiceSent: InvoiceSent;
  PaymentRegistered: PaymentRegistered;
  BillReceived: BillReceived;
  BillApproved: BillApproved;
  BillPaymentRegistered: BillPaymentRegistered;
}

export type DomainEventType = keyof DomainEventMap;
