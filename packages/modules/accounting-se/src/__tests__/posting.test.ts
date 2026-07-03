/**
 * Integration test — proves the core architectural claim of Milestone 3:
 *
 *   "Every business event MAY generate accounting entries, but the kernel
 *    never generates accounting logic."
 *
 * M2 domain events (CustomerCreated, InvoiceSent, PaymentRegistered, ...) and
 * M3 accounting events (VerificationCreated, ...) are appended to the SAME
 * Postgres event log for a company. Each module's projection only folds the
 * event types it understands and ignores the rest — proven here by replaying
 * both the kernel's business state and this module's accounting state from
 * the identical log and checking neither sees the other's entities.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  EventStore,
  replayCompany,
  createCustomer,
  createInvoice,
  sendInvoice,
  registerPayment,
  createSupplier,
  receiveBill,
  approveBill,
  registerBillPayment,
  defaultDeps as kernelDeps,
  type Pool,
} from "@businessos/kernel";
import { replayAccounting } from "../replay.js";
import { createVerification } from "../commands.js";
import {
  billApprovedToVerification,
  billPaymentToVerification,
  invoiceSentToVerification,
  paymentToVerification,
} from "../translator.js";
import { trialBalance } from "../reports.js";
import { defaultDeps as accountingDeps } from "../commands.js";
import { resetEvents, testPool } from "./helpers.js";

const pool: Pool = testPool();
const store = new EventStore(pool);

beforeEach(() => resetEvents(pool));
afterAll(() => pool.end());

const COMPANY = "00000000-0000-0000-0000-000000000040";

describe("posting accounting entries alongside the M2 domain", () => {
  it("business and accounting events coexist in one log without interfering", async () => {
    const kDeps = kernelDeps();
    const aDeps = accountingDeps();

    // --- Sales side: customer, invoice, send, pay ---
    const customer = createCustomer({ companyId: COMPANY, name: "Ada" }, kDeps);
    await store.append([customer]);

    const invoiceDraft = createInvoice(
      { companyId: COMPANY, customerId: customer.payload.customerId, amount: 100000, dueDate: "2026-12-31" },
      kDeps,
    );
    await store.append([invoiceDraft]);

    let business = await replayCompany(store, COMPANY);
    let invoice = business.invoices.find((i) => i.id === invoiceDraft.payload.invoiceId)!;
    const sentEvent = sendInvoice(invoice, { companyId: COMPANY }, kDeps);
    await store.append([sentEvent]);

    business = await replayCompany(store, COMPANY);
    invoice = business.invoices.find((i) => i.id === invoice.id)!;

    // Translate the InvoiceSent business fact into an accounting entry —
    // this call site is the only place that knows both domains exist.
    let accounting = await replayAccounting(store, COMPANY);
    const invoiceVerificationDraft = invoiceSentToVerification(invoice, sentEvent.id);
    const invoiceVerification = createVerification(
      accounting,
      { companyId: COMPANY, ...invoiceVerificationDraft },
      aDeps,
    );
    await store.append([invoiceVerification]);

    const paymentEvent = registerPayment(invoice, { companyId: COMPANY, amount: 100000 }, kDeps);
    await store.append([paymentEvent]);
    business = await replayCompany(store, COMPANY);
    const payment = business.payments.find((p) => p.invoiceId === invoice.id)!;

    accounting = await replayAccounting(store, COMPANY);
    const paymentVerificationDraft = paymentToVerification(payment, paymentEvent.id);
    const paymentVerification = createVerification(
      accounting,
      { companyId: COMPANY, ...paymentVerificationDraft },
      aDeps,
    );
    await store.append([paymentVerification]);

    // --- Purchase side: supplier, bill, approve, pay ---
    const supplier = createSupplier({ companyId: COMPANY, name: "Acme Supplies" }, kDeps);
    await store.append([supplier]);
    const billDraft = receiveBill(
      { companyId: COMPANY, supplierId: supplier.payload.supplierId, amount: 50000, dueDate: "2026-12-31" },
      kDeps,
    );
    await store.append([billDraft]);

    business = await replayCompany(store, COMPANY);
    let bill = business.bills.find((b) => b.id === billDraft.payload.billId)!;
    const approvedEvent = approveBill(bill, { companyId: COMPANY }, kDeps);
    await store.append([approvedEvent]);
    business = await replayCompany(store, COMPANY);
    bill = business.bills.find((b) => b.id === bill.id)!;

    accounting = await replayAccounting(store, COMPANY);
    const billVerificationDraft = billApprovedToVerification(bill, approvedEvent.id);
    const billVerification = createVerification(
      accounting,
      { companyId: COMPANY, ...billVerificationDraft },
      aDeps,
    );
    await store.append([billVerification]);

    const billPaymentEvent = registerBillPayment(bill, { companyId: COMPANY, amount: 50000 }, kDeps);
    await store.append([billPaymentEvent]);
    business = await replayCompany(store, COMPANY);
    const billPayment = business.billPayments.find((p) => p.billId === bill.id)!;

    accounting = await replayAccounting(store, COMPANY);
    const billPaymentVerificationDraft = billPaymentToVerification(billPayment, billPaymentEvent.id);
    const billPaymentVerification = createVerification(
      accounting,
      { companyId: COMPANY, ...billPaymentVerificationDraft },
      aDeps,
    );
    await store.append([billPaymentVerification]);

    // --- Assertions: replay both projections from the SAME log ---
    const finalBusiness = await replayCompany(store, COMPANY);
    const finalAccounting = await replayAccounting(store, COMPANY);

    expect(finalBusiness.invoices[0]?.status).toBe("paid");
    expect(finalBusiness.bills[0]?.status).toBe("paid");

    expect(finalAccounting.verifications).toHaveLength(4);
    const tb = trialBalance(finalAccounting.verifications);
    expect(tb.balanced).toBe(true);
    // Bank should net to +100000 (received) -50000 (paid) = 50000.
    const bank = tb.lines.find((l) => l.account === "1930");
    expect(bank?.balance).toBe(50000);

    // The kernel's business projection never saw a "VerificationCreated"
    // event corrupt its state, and the accounting projection never saw a
    // "CustomerCreated" event corrupt its ledger — same log, two disjoint
    // readings of it.
    const rawEvents = await store.byCompany(COMPANY);
    expect(rawEvents.map((e) => e.type).sort()).toEqual(
      [
        "CustomerCreated",
        "InvoiceCreated",
        "InvoiceSent",
        "PaymentRegistered",
        "SupplierCreated",
        "BillReceived",
        "BillApproved",
        "BillPaymentRegistered",
        "VerificationCreated",
        "VerificationCreated",
        "VerificationCreated",
        "VerificationCreated",
      ].sort(),
    );
  });

  it("accounting replay is deterministic, matching the kernel's own reproducibility guarantee", async () => {
    const aDeps = accountingDeps();
    const draft = createVerification(
      await replayAccounting(store, COMPANY),
      {
        companyId: COMPANY,
        date: "2026-01-01",
        description: "Opening balance",
        rows: [
          { account: "1930", debit: 50000, credit: 0 },
          { account: "3001", debit: 0, credit: 50000 },
        ],
      },
      aDeps,
    );
    await store.append([draft]);

    const first = await replayAccounting(store, COMPANY);
    const second = await replayAccounting(store, COMPANY);
    expect(second).toEqual(first);
  });
});
