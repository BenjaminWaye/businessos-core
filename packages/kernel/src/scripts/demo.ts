/**
 * Hands-on demo: kernel (M1) + business domain (M2).
 *
 * Writes real events to the `businessos` database, then rebuilds state purely
 * by replaying the log — so you can watch the kernel be deterministic, and see
 * an invoice move through its lifecycle (draft -> sent -> partially_paid ->
 * paid, plus a separate overdue example) as derived, not stored, state.
 *
 * Safe to run repeatedly: each run uses a fresh random company id.
 *
 *   pnpm demo
 */

import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import {
  createPool,
  EventStore,
  replayCompany,
  createCustomer,
  updateCustomer,
  createInvoice,
  sendInvoice,
  registerPayment,
  defaultDeps,
} from "../index.js";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(resolve(here, "../../../.."), ".env") });

function log(title: string, value: unknown): void {
  console.log(`\n[1m${title}[0m`);
  console.dir(value, { depth: null });
}

async function main(): Promise<void> {
  const pool = createPool();
  const store = new EventStore(pool);
  const deps = defaultDeps();
  const company = randomUUID();
  const now = new Date();

  console.log(`Company for this run: ${company}`);

  try {
    // 1. Command -> Event -> append to the log.
    const ada = createCustomer(
      { companyId: company, name: "Ada Lovelace", email: "ada@acme.test" },
      deps,
    );
    const grace = createCustomer({ companyId: company, name: "Grace" }, deps);
    await store.append([ada, grace]);

    // 2. Later, update Ada — another event, not an edit.
    await store.append([
      updateCustomer(
        { companyId: company, customerId: ada.payload.customerId, name: "Ada L." },
        deps,
      ),
    ]);

    // 3. Invoice lifecycle: draft -> sent -> partially_paid -> paid.
    const dueSoon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const invoiceDraft = createInvoice(
      { companyId: company, customerId: ada.payload.customerId, amount: 100000, dueDate: dueSoon },
      deps,
    );
    await store.append([invoiceDraft]);

    let state = await replayCompany(store, company);
    let invoice = state.invoices.find((i) => i.id === invoiceDraft.payload.invoiceId)!;
    console.log(`\nInvoice created — status: ${invoice.status}`);

    await store.append([sendInvoice(invoice, { companyId: company }, deps)]);
    state = await replayCompany(store, company);
    invoice = state.invoices.find((i) => i.id === invoice.id)!;
    console.log(`Invoice sent — status: ${invoice.status}`);

    await store.append([
      registerPayment(invoice, { companyId: company, amount: 40000 }, deps),
    ]);
    state = await replayCompany(store, company);
    invoice = state.invoices.find((i) => i.id === invoice.id)!;
    console.log(
      `Paid 400.00 of 1000.00 — status: ${invoice.status} (amountPaid: ${invoice.amountPaid})`,
    );

    await store.append([
      registerPayment(invoice, { companyId: company, amount: 60000 }, deps),
    ]);
    state = await replayCompany(store, company);
    invoice = state.invoices.find((i) => i.id === invoice.id)!;
    console.log(`Paid the remaining 600.00 — status: ${invoice.status}`);

    // 4. A second invoice, sent but never paid, with a due date in the past —
    //    "overdue" is derived at read time, never written as an event.
    const overdueInvoiceDraft = createInvoice(
      {
        companyId: company,
        customerId: ada.payload.customerId,
        amount: 50000,
        dueDate: "2020-01-01T00:00:00.000Z",
      },
      deps,
    );
    await store.append([overdueInvoiceDraft]);
    state = await replayCompany(store, company);
    const overdueDraft = state.invoices.find((i) => i.id === overdueInvoiceDraft.payload.invoiceId)!;
    await store.append([sendInvoice(overdueDraft, { companyId: company }, deps)]);

    state = await replayCompany(store, company); // asOf defaults to "now"
    const overdue = state.invoices.find((i) => i.id === overdueDraft.id)!;
    console.log(
      `\nSecond invoice, due 2020-01-01, sent but unpaid — status: ${overdue.status} (never written as an event, only derived by project())`,
    );

    // 5. The raw, immutable log vs. the derived state.
    log("Event log (source of truth):", await store.byCompany(company));
    log("Replayed state:", state);

    const a = await replayCompany(store, company, now.toISOString());
    const b = await replayCompany(store, company, now.toISOString());
    console.log(
      `\nReplaying twice with the same asOf is identical: [1m${JSON.stringify(a) === JSON.stringify(b)}[0m`,
    );

    // 6. Prove immutability: try to tamper with the log directly.
    try {
      await pool.query("UPDATE events SET type = 'Tampered' WHERE company_id = $1", [
        company,
      ]);
      console.log("\n[31mImmutability FAILED — update went through![0m");
    } catch (err) {
      console.log(
        `\nLog is immutable — direct UPDATE rejected: [1m${(err as Error).message}[0m`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
