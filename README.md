# businessos-core

Deterministic, event-sourced backend for running a business: a stable
**kernel** (business truth), pluggable **modules** (accounting today; CRM,
payroll later), a deterministic **workflow/task engine**, and an HTTP API. This
repo is the backend only — no UI lives here. A separate frontend is expected
to talk to it over the HTTP API described below.

## Core idea

Nothing is stored as "current state." Every fact is an **event**, appended to
one immutable, append-only Postgres log per company. All state — customers,
invoices, ledger balances, workflow instances — is *derived* by replaying that
log through a pure projection function. Rebuilding from scratch always
produces identical output; that's the property the whole system is built to
guarantee, and it's what every test suite in this repo is ultimately checking.

```
Command → Event → (append to log) → Projection (pure fold) → State
```

## What's in this repo

| Package | What it is |
|---|---|
| [`packages/kernel`](packages/kernel) | Event store (Postgres, immutable/append-only), command→event pipeline, projection engine, replay. Business domain: Customer, Supplier, Invoice + Payment (accounts receivable), Bill + BillPayment (accounts payable). |
| [`packages/modules/accounting-se`](packages/modules/accounting-se) | Swedish bookkeeping: BAS chart of accounts, double-entry verifications, fiscal years, VAT, trial balance / income statement / balance sheet, SIE4 export. Reuses the kernel's event log; the kernel has no idea this exists. |
| [`packages/workflows`](packages/workflows) | Deterministic workflow + task engine. Converts business events (e.g. `InvoiceCreated`) into tracked tasks (e.g. `SendInvoiceTask`) with a full lifecycle, without ever executing anything itself. |
| [`packages/modules/expenses`](packages/modules/expenses) | Employee expense claims: submit → approve → reimburse, modeled directly on the kernel's Bill/BillPayment lifecycle. Reuses the kernel's event log; the kernel has no idea this exists. |
| [`packages/modules/payroll`](packages/modules/payroll) | Swedish payroll: employees, payroll runs, payslips generated from Skatteverket's real 2026 monthly withholding tables and age-banded employer fee rates. Covers generate → adjust → lock only (tax declaration/payment/ledger-booking are a later phase). Reuses the kernel's event log; the kernel has no idea this exists. |
| [`apps/api`](apps/api) | Express HTTP layer over all of the above. No business logic of its own — every route loads state, calls a command, appends, responds. **This is what a UI should talk to.** |

Each package also fully explains its own design decisions in its source
comments and tests — this README is the map, not the territory.

### What's deliberately NOT here yet

No AI, no external execution (bank integrations, BankID, email sending, OCR),
no payroll, no UI. The workflow engine only ever *creates tasks* — it never
calls an external system. That's the next layer (execution agents), not yet
built.

## Quick start

Requires Node ≥ 20, pnpm, and a local Postgres server.

```bash
cp .env.example .env          # adjust connection strings if your Postgres differs
createdb businessos
createdb businessos_test
pnpm install
pnpm migrate                  # applies infrastructure/migrations/ to DATABASE_URL
pnpm test                     # 112 tests across kernel / accounting-se / workflows / api
pnpm demo                     # walks through a customer + invoice lifecycle by hand, prints state
pnpm dev:api                  # starts the HTTP API on http://localhost:3001
```

`pnpm test` and `pnpm dev:api` both need Postgres running and migrated first.

## Using the HTTP API (for a UI)

All endpoints are company-scoped: every request needs a `companyId` (a
free-form string/uuid you choose — there's no signup flow, a company is just
whatever id you first use to create data under). `GET` routes take it as a
query param; `POST` routes take it in the JSON body.

Money amounts are always integers in **minor currency units** (e.g. öre, not
kronor) to avoid floating-point rounding — `100000` means 1 000.00 SEK.

### Customers & suppliers

```
POST /customers          { companyId, name, email? }              -> { customerId }
GET  /customers?companyId=...                                      -> Customer[]
POST /suppliers           { companyId, name, email? }              -> { supplierId }
GET  /suppliers?companyId=...                                      -> Supplier[]
```

### Invoices — accounts receivable (`draft → sent → partially_paid/paid`)

```
POST /invoices            { companyId, customerId, amount, currency?, dueDate } -> { invoiceId }
GET  /invoices?companyId=...                                        -> Invoice[]
POST /invoices/:id/send   { companyId }                             -> { invoiceId, status }
POST /payments             { companyId, invoiceId, amount }          -> Invoice
```

`status` on a returned invoice may be `"overdue"` — this is computed at read
time (never stored) whenever a sent-but-unpaid invoice's `dueDate` has passed.

### Bills — accounts payable (`received → approved → partially_paid/paid`)

```
POST /bills                { companyId, supplierId, amount, currency?, dueDate } -> { billId }
GET  /bills?companyId=...                                          -> Bill[]
POST /bills/:id/approve    { companyId }                            -> { billId, status }
POST /bill-payments         { companyId, billId, amount }            -> Bill
```

### Expense claims (`submitted → approved → partially_reimbursed/reimbursed`)

Same lifecycle as Bills, for money owed to a claimant instead of a supplier — no Employee entity exists yet (that's Payroll's domain), so a claim just carries a free-text claimant name/email.

```
POST /expenses              { companyId, claimantName, claimantEmail?, description, amount, currency? } -> { expenseClaimId }
GET  /expenses?companyId=...                                        -> ExpenseClaim[]
POST /expenses/:id/approve  { companyId }                            -> { expenseClaimId, status }
POST /expense-reimbursements { companyId, expenseClaimId, amount }    -> ExpenseClaim
```

### Payroll (Swedish) — employees, payroll runs, payslips

Generate → adjust → lock only. Tax withholding is looked up from Skatteverket's
real published 2026 monthly tables (`GET /payroll/tax-tables` lists the known
table numbers, `GET /payroll/municipalities` gives a convenience suggested
table per municipality — the employer still picks the table explicitly on
each employee). Employer fee rate is derived automatically from the
employee's age at the payroll period. There is no "apply VÄXA-stöd" action —
as of the 2026 reform it's a retroactive refund claimed directly with
Skatteverket, not a payroll-time rate reduction.

```
POST /employees             { companyId, name, email?, personalNumber?, birthDate?, monthlySalary, taxTable } -> { employeeId }
GET  /employees?companyId=...                                        -> Employee[]
POST /employees/:id/terminate { companyId }                           -> { employeeId, status }
GET  /payroll/tax-tables                                              -> number[] (known Skatteverket table numbers)
GET  /payroll/municipalities                                          -> { name, suggestedTable }[]
POST /payroll-runs           { companyId, year, month }                -> { payrollRunId }
GET  /payroll-runs?companyId=...                                      -> PayrollRun[]
POST /payroll-runs/:id/finalize { companyId }                          -> { payrollRunId, status } (locks the run — no more payslips can be generated)
POST /payslips                { companyId, payrollRunId, employeeId }  -> Payslip (gross/tax/net/employer fee, computed from the real tables)
GET  /payslips?companyId=...&payrollRunId=...                         -> Payslip[]
```

### Accounting (Swedish/BAS)

```
GET  /accounting/accounts?companyId=...                                        -> BasAccount[] (curated BAS template + this company's own custom accounts)
POST /accounting/accounts              { companyId, code, name, class }         -> { accountId, code } (adds a custom account to this company's chart)
POST /accounting/verifications         { companyId, series, date, description, rows, sourceEventId? } -> { verificationId, number }
GET  /accounting/verifications?companyId=...                                    -> Verification[]
POST /accounting/verifications/:id/reverse { companyId, date, description? }    -> { verificationId, number } (mirrored reversing entry; never edits/deletes the original)
GET  /accounting/fiscal-years?companyId=...                                    -> FiscalYear[]
POST /accounting/fiscal-years          { companyId, startDate, endDate }        -> { fiscalYearId }
POST /accounting/fiscal-years/:id/close { companyId }                           -> { fiscalYearId, closed }
GET  /accounting/trial-balance?companyId=...
GET  /accounting/income-statement?companyId=...
GET  /accounting/balance-sheet?companyId=...
GET  /accounting/vat-report?companyId=...&periodStart=...&periodEnd=...
GET  /accounting/sie?companyId=...&fiscalYearId=...&orgNumber=...&name=...     -> text/plain SIE4 file
```

Postings are never automatic — `POST /accounting/verifications` is how
something becomes a ledger entry. Nothing in `/invoices` or `/payments`
touches the ledger by itself (yet).

### Workflows & tasks

```
GET  /workflows?companyId=...        -> WorkflowInstance[]
GET  /tasks?companyId=...             -> Task[]
POST /tasks/:id/start   { companyId }                    -> Task (created -> in_progress)
POST /tasks/:id/complete { companyId, output? }           -> Task (in_progress -> completed)
```

Creating an invoice, sending it, and paying it automatically drives the
built-in `invoice-workflow` (see `packages/workflows/src/definitions.ts`):
`InvoiceCreated` starts it and creates a `SendInvoiceTask`; `InvoiceSent`
advances it and creates a `MonitorPaymentTask`; `PaymentRegistered` completes
it. `/tasks/:id/start` and `/tasks/:id/complete` let a UI actually work a
task — this doesn't execute anything for real (no email is sent, no bank
call is made); it's a manual stand-in for the execution-agent layer that
doesn't exist yet. There's no `/tasks/:id/fail` or block endpoint yet — the
underlying kernel command (`applyTaskResult`) supports it, just not wired to
a route; ask if the UI needs it.

### Raw event log & everything at once

```
GET /events?companyId=...   -> StoredEvent[]   (the immutable log itself, in canonical order — for a Replay/debug screen)
GET /state?companyId=...    -> { customers, suppliers, invoices, payments, bills, billPayments }
```

### Errors

Every error response is `{ "error": "<message>" }`.
- `400` — bad/missing input, or a business rule was violated (e.g. "payment
  exceeds remaining balance"). The message is the exact error the kernel/module
  threw — safe to show directly in a UI.
- `404` — referenced an id (invoice, bill, fiscal year) that doesn't exist for
  that `companyId`.

## Determinism guarantees (why you can trust replay)

- Every projection is a pure function: same events (+ same `asOf` time, where
  relevant) in, same state out. No projection reads `Date.now()` internally —
  wherever "now" matters (e.g. deriving `overdue`), it's an explicit parameter
  read once at the edge (`replay.ts`), not hidden inside the fold.
- Events are sorted into canonical order (a global, monotonically increasing
  sequence number) before folding, so the order they happen to be fetched in
  can never change the result.
- The event log is immutable at the database level — a Postgres trigger
  rejects `UPDATE`/`DELETE` on the `events` table outright. Corrections are
  always new events (e.g. a reversing accounting verification), never edits.

## Repo layout

```
packages/kernel/                    event store, command/projection/replay core + business domain
packages/modules/accounting-se/     Swedish accounting module — reuses the kernel's event store
packages/modules/expenses/          employee expense claims — reuses the kernel's event store
packages/modules/payroll/           Swedish payroll (employees, runs, payslips) — reuses the kernel's event store
packages/workflows/                 deterministic workflow + task engine — reuses the kernel's event store
apps/api/                           HTTP API over the kernel + modules — what a UI talks to
infrastructure/migrations/          raw SQL migrations
```

## Roadmap

Built in this order, each proven with its own test suite before the next
started:

1. ✅ Deterministic kernel (event store, command→event pipeline, projection, replay)
2. ✅ Business domain core (customers, suppliers, invoices, bills, payments)
3. ✅ Swedish accounting module (BAS, double-entry, VAT, SIE4)
4. ✅ Deterministic workflow + task engine
5. ⬜ Execution agents (the layer that actually *does* things — bank/BankID/email — driven by tasks this repo already creates)

A UI is being built as a separate project against the API described above.
