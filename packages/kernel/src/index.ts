/**
 * BusinessOS kernel — public surface (Milestone 2).
 *
 * The deterministic core: event store, command pipeline, projection engine,
 * replay — plus the core business domain modeled on top of it: customers,
 * suppliers, invoices/payments (accounts receivable), and bills/bill payments
 * (accounts payable).
 */

export type { EventDraft, StoredEvent } from "./types.js";
export { compareEvents } from "./types.js";

export type {
  Customer,
  CustomerCreated,
  CustomerUpdated,
  Supplier,
  SupplierCreated,
  Invoice,
  InvoiceStatus,
  InvoiceCreated,
  InvoiceSent,
  Payment,
  PaymentRegistered,
  Bill,
  BillStatus,
  BillReceived,
  BillApproved,
  BillPayment,
  BillPaymentRegistered,
  State,
  DomainEventMap,
  DomainEventType,
} from "./state.js";
export { initialState } from "./state.js";

export { project } from "./projection.js";

export type {
  CommandDeps,
  CreateCustomerInput,
  UpdateCustomerInput,
  CreateSupplierInput,
  CreateInvoiceInput,
  SendInvoiceInput,
  RegisterPaymentInput,
  ReceiveBillInput,
  ApproveBillInput,
  RegisterBillPaymentInput,
} from "./commands.js";
export {
  defaultDeps,
  createCustomer,
  updateCustomer,
  createSupplier,
  createInvoice,
  sendInvoice,
  registerPayment,
  receiveBill,
  approveBill,
  registerBillPayment,
} from "./commands.js";

export { createPool } from "./db.js";
export type { Pool } from "./db.js";

export { EventStore } from "./event-store.js";

export { replayCompany } from "./replay.js";
