/**
 * Projection engine: events -> state.
 *
 * This is the deterministic heart of the kernel. `project` is a pure function:
 *
 *   - Same events + same `asOf` -> same state, always.
 *   - No hidden dependencies, no randomness. The one piece of real-world input
 *     it needs — "what time is it, for deriving overdue invoices" — is an
 *     explicit parameter, never read internally via `Date.now()`. The actual
 *     wall clock is read exactly once, at the edge (`replay.ts`), exactly like
 *     `CommandDeps` injects ids/clock into commands. This keeps `project`
 *     reproducible: pass the same `asOf` again and you get the same state,
 *     including which invoices are overdue.
 *   - Independent of the order events are *handed in*: they are sorted into the
 *     canonical order (by global sequence) before folding. Shuffling the input
 *     array cannot change the output.
 *
 * It never mutates the input array.
 */

import { compareEvents, type StoredEvent } from "./types.js";
import {
  initialState,
  type Bill,
  type BillApproved,
  type BillPaymentRegistered,
  type BillReceived,
  type CustomerCreated,
  type CustomerUpdated,
  type Invoice,
  type InvoiceCreated,
  type InvoiceSent,
  type PaymentRegistered,
  type State,
  type SupplierCreated,
} from "./state.js";

/** Apply a single event to a state, returning the next state. Pure. */
function apply(state: State, event: StoredEvent): State {
  switch (event.type) {
    case "CustomerCreated": {
      const p = event.payload as CustomerCreated;
      return {
        ...state,
        customers: [
          ...state.customers,
          { id: p.customerId, name: p.name, email: p.email, createdAt: event.occurredAt },
        ],
      };
    }

    case "CustomerUpdated": {
      const p = event.payload as CustomerUpdated;
      return {
        ...state,
        customers: state.customers.map((c) =>
          c.id === p.customerId
            ? {
                ...c,
                ...(p.name !== undefined ? { name: p.name } : {}),
                ...(p.email !== undefined ? { email: p.email } : {}),
              }
            : c,
        ),
      };
    }

    case "SupplierCreated": {
      const p = event.payload as SupplierCreated;
      return {
        ...state,
        suppliers: [
          ...state.suppliers,
          { id: p.supplierId, name: p.name, email: p.email, createdAt: event.occurredAt },
        ],
      };
    }

    case "InvoiceCreated": {
      const p = event.payload as InvoiceCreated;
      const invoice: Invoice = {
        id: p.invoiceId,
        customerId: p.customerId,
        amount: p.amount,
        currency: p.currency,
        dueDate: p.dueDate,
        status: "draft",
        amountPaid: 0,
        createdAt: event.occurredAt,
      };
      return { ...state, invoices: [...state.invoices, invoice] };
    }

    case "InvoiceSent": {
      const p = event.payload as InvoiceSent;
      return {
        ...state,
        invoices: state.invoices.map((inv) =>
          inv.id === p.invoiceId ? { ...inv, status: "sent" } : inv,
        ),
      };
    }

    case "PaymentRegistered": {
      const p = event.payload as PaymentRegistered;
      return {
        ...state,
        payments: [
          ...state.payments,
          {
            id: p.paymentId,
            invoiceId: p.invoiceId,
            amount: p.amount,
            currency: p.currency,
            registeredAt: event.occurredAt,
          },
        ],
        invoices: state.invoices.map((inv) => {
          if (inv.id !== p.invoiceId) return inv;
          const amountPaid = inv.amountPaid + p.amount;
          return {
            ...inv,
            amountPaid,
            status: amountPaid >= inv.amount ? "paid" : "partially_paid",
          };
        }),
      };
    }

    case "BillReceived": {
      const p = event.payload as BillReceived;
      const bill: Bill = {
        id: p.billId,
        supplierId: p.supplierId,
        amount: p.amount,
        currency: p.currency,
        dueDate: p.dueDate,
        status: "received",
        amountPaid: 0,
        createdAt: event.occurredAt,
      };
      return { ...state, bills: [...state.bills, bill] };
    }

    case "BillApproved": {
      const p = event.payload as BillApproved;
      return {
        ...state,
        bills: state.bills.map((b) =>
          b.id === p.billId ? { ...b, status: "approved" } : b,
        ),
      };
    }

    case "BillPaymentRegistered": {
      const p = event.payload as BillPaymentRegistered;
      return {
        ...state,
        billPayments: [
          ...state.billPayments,
          {
            id: p.billPaymentId,
            billId: p.billId,
            amount: p.amount,
            currency: p.currency,
            registeredAt: event.occurredAt,
          },
        ],
        bills: state.bills.map((b) => {
          if (b.id !== p.billId) return b;
          const amountPaid = b.amountPaid + p.amount;
          return {
            ...b,
            amountPaid,
            status: amountPaid >= b.amount ? "paid" : "partially_paid",
          };
        }),
      };
    }

    // Unknown event types are ignored, not an error: this lets the log carry
    // events from domains the current projection does not understand.
    default:
      return state;
  }
}

/**
 * Overlay derived state: an invoice/bill is "overdue" if it has been
 * sent/approved (or partially paid) and its due date has passed as of `asOf`,
 * but it is not yet fully paid. This is deliberately NOT a persisted event —
 * "time passed" is not a business fact that happened, it's a read-time
 * computation.
 */
function deriveOverdue(state: State, asOf: string): State {
  return {
    ...state,
    invoices: state.invoices.map((inv) =>
      (inv.status === "sent" || inv.status === "partially_paid") && inv.dueDate < asOf
        ? { ...inv, status: "overdue" }
        : inv,
    ),
    bills: state.bills.map((b) =>
      (b.status === "approved" || b.status === "partially_paid") && b.dueDate < asOf
        ? { ...b, status: "overdue" }
        : b,
    ),
  };
}

/**
 * Fold a set of events into business state, as of a given point in time.
 *
 * The input is copied and sorted into canonical order first, so callers may
 * pass events in any order (e.g. as returned from a query, or shuffled) and
 * still get an identical result.
 *
 * @param asOf ISO 8601 timestamp used only to derive overdue invoice status.
 *   Pass the same value again to reproduce the exact same state.
 */
export function project(events: readonly StoredEvent[], asOf: string): State {
  const folded = [...events].sort(compareEvents).reduce(apply, initialState());
  return deriveOverdue(folded, asOf);
}
