/**
 * Translator: M2 business events MAY generate accounting entries, but the
 * kernel never generates accounting logic — that rule is implemented here,
 * entirely outside the kernel. These are pure functions: business entity in,
 * verification input out. Nothing is appended by this file; the caller
 * decides whether/when to call `createVerification` with the result (see
 * apps/api or the demo script for the wiring).
 *
 * Swedish standard VAT (25%) is assumed, and invoice/bill `amount` is treated
 * as VAT-inclusive (gross) — i.e. what the customer actually pays/what you
 * actually owe. The net/VAT split is derived by subtraction from the gross
 * amount (`vat = gross - net`), not computed independently, so the two legs
 * always sum to exactly the gross amount in integer minor units — no penny
 * left unbalanced by rounding.
 */

import type { Bill, BillPayment, Invoice, Payment } from "@businessos/kernel";
import type { CreateVerificationInput } from "./commands.js";
import type { VerificationRow } from "./types.js";

const VAT_RATE = 0.25;

function splitVat(gross: number): { net: number; vat: number } {
  const net = Math.round(gross / (1 + VAT_RATE));
  return { net, vat: gross - net };
}

type Draft = Omit<CreateVerificationInput, "companyId">;

/** InvoiceSent -> Dr Kundfordringar (1510) / Cr Försäljning (3001) + Utgående moms (2611). */
export function invoiceSentToVerification(invoice: Invoice, sourceEventId: string): Draft {
  const { net, vat } = splitVat(invoice.amount);
  const rows: VerificationRow[] = [
    { account: "1510", debit: invoice.amount, credit: 0 },
    { account: "3001", debit: 0, credit: net },
    { account: "2611", debit: 0, credit: vat },
  ];
  return {
    date: invoice.createdAt.slice(0, 10),
    description: `Invoice sent to customer ${invoice.customerId}`,
    sourceEventId,
    rows,
  };
}

/** PaymentRegistered -> Dr Bank (1930) / Cr Kundfordringar (1510). */
export function paymentToVerification(payment: Payment, sourceEventId: string): Draft {
  const rows: VerificationRow[] = [
    { account: "1930", debit: payment.amount, credit: 0 },
    { account: "1510", debit: 0, credit: payment.amount },
  ];
  return {
    date: payment.registeredAt.slice(0, 10),
    description: `Payment received for invoice ${payment.invoiceId}`,
    sourceEventId,
    rows,
  };
}

/** BillApproved -> Dr Inköp (4010) + Ingående moms (2641) / Cr Leverantörsskulder (2440). */
export function billApprovedToVerification(bill: Bill, sourceEventId: string): Draft {
  const { net, vat } = splitVat(bill.amount);
  const rows: VerificationRow[] = [
    { account: "4010", debit: net, credit: 0 },
    { account: "2641", debit: vat, credit: 0 },
    { account: "2440", debit: 0, credit: bill.amount },
  ];
  return {
    date: bill.createdAt.slice(0, 10),
    description: `Bill approved from supplier ${bill.supplierId}`,
    sourceEventId,
    rows,
  };
}

/** BillPaymentRegistered -> Dr Leverantörsskulder (2440) / Cr Bank (1930). */
export function billPaymentToVerification(billPayment: BillPayment, sourceEventId: string): Draft {
  const rows: VerificationRow[] = [
    { account: "2440", debit: billPayment.amount, credit: 0 },
    { account: "1930", debit: 0, credit: billPayment.amount },
  ];
  return {
    date: billPayment.registeredAt.slice(0, 10),
    description: `Payment made for bill ${billPayment.billId}`,
    sourceEventId,
    rows,
  };
}
