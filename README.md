# BusinessOS

A deterministic, event-sourced operating system for running a business: a stable
**kernel** (business truth), pluggable **modules** (accounting, CRM, payroll…),
deterministic **workflows**, and an external **execution layer** of agents that
perform real-world actions. AI interprets — it never decides.

## Status: Milestone 3 — Swedish Accounting Module

On top of the Milestone 1 kernel and Milestone 2 business domain, the first
real **module** (`packages/modules/accounting-se`) lives entirely outside the
kernel and the M2 domain, proving the plug-in architecture: it defines its own
event types and projection, and reuses the *same* Postgres event log — the
kernel never knows accounting exists.

- **BAS chart of accounts** (curated subset: bank, receivables, payables,
  input/output VAT, sales, purchases) — `accounts.ts`
- **Verification** (verifikation): double-entry, `debit === credit` enforced
  at command time, immutable once posted — corrections are a new *reversing*
  verification (mirrored debit/credit), never an edit or delete
- **Fiscal years**: `openFiscalYear` / `closeFiscalYear`; a closed year locks
  every verification date within it — `createVerification` rejects postings
  into a closed period
- **Sequential voucher numbering** per series (e.g. `"A"`), computed from
  current state the same way M2's `sendInvoice` validates against the current
  `Invoice`
- **Translator** (`translator.ts`): pure functions mapping M2 domain entities
  (Invoice, Payment, Bill, BillPayment) to balanced verification drafts —
  this is where "a business event MAY generate accounting entries, but the
  kernel never generates accounting logic" actually lives. Nothing is
  auto-posted; the caller (API/demo) decides when to translate and post.
- **Reports** (`reports.ts`), all pure functions over verifications: ledger,
  trial balance, income statement, balance sheet, VAT report. The
  accounting identity `assets = equity + liabilities + (revenue − costs)`
  falls out automatically from every verification balancing — never
  special-cased in the reports (see the reports test suite)
- **SIE4 export** (MVP, not certified) — `sie.ts`
- **HTTP API**: `POST /accounting/verifications /fiscal-years`,
  `POST /accounting/fiscal-years/:id/close`, `GET /accounting/trial-balance
  /income-statement /balance-sheet /vat-report /sie`
- **Tests** — 33 tests: balanced-entry enforcement, reversal semantics, locked
  periods, sequential numbering, VAT split exactness, the accounting
  identity, and a DB-backed integration test proving M2 and M3 events coexist
  in one log without either projection seeing the other's event types

One clarification worth flagging: the original spec listed `FiscalYearClosed`
but not an explicit "opened" event — `FiscalYearOpened` was added because a
fiscal year has to exist before it can be closed or checked against.

### Milestone 2 — Business Domain Core

Real business objects on top of the kernel:

- **Domain**: Customer, Supplier, Invoice, Payment (accounts receivable), Bill,
  BillPayment (accounts payable) (`packages/kernel/src/state.ts`)
- **Commands**: `createCustomer`, `updateCustomer`, `createSupplier`,
  `createInvoice`, `sendInvoice`, `registerPayment`, `receiveBill`,
  `approveBill`, `registerBillPayment` (`packages/kernel/src/commands.ts`)
- **Invoice lifecycle** (AR — money owed to you): `draft → sent →
  partially_paid/paid`, folded from events. `overdue` is **derived at read
  time**, never persisted as an event — passing time is not a business fact
  (`packages/kernel/src/projection.ts`)
- **Bill lifecycle** (AP — money you owe a supplier): `received → approved →
  partially_paid/paid`, same overdue-derivation rule. Kept as a **separate
  entity from Invoice**, not "Invoice with a direction flag" — you *send* an
  invoice but *receive* a bill, and a bill needs approval, which has no
  equivalent step on the sales side. This also keeps input vs. output VAT
  (Milestone 3) easy to reason about.
- **Rules enforced by commands**: an invoice must be `draft` to send, a bill
  must be `received` to approve; a payment must reference a sent
  invoice/approved bill and cannot exceed the remaining balance
- **HTTP API** (`apps/api`) — thin layer over the kernel, no business logic of
  its own: `POST /customers /suppliers /invoices /payments /bills
  /bill-payments`, `POST /invoices/:id/send /bills/:id/approve`,
  `GET /customers /invoices /bills /state`
- **Tests** — invoice lifecycle (draft→sent→paid), bill lifecycle
  (received→approved→paid), partial payment, overdue derivation, ordering
  invariance, replay — 41 kernel tests, plus 9 Supertest integration tests
  over the HTTP API (happy paths, 404s on unknown ids, 400s on rule
  violations — `apps/api/src/__tests__/app.test.ts`)

### Determinism guarantees

- `project(events, asOf)` is pure: given the same events and the same `asOf`,
  it always returns the same state. The only piece of real-world input it
  needs — current time, for deriving overdue invoices — is an explicit
  parameter, never read internally via `Date.now()`. The real clock is read
  exactly once, at the edge, in `replay.ts`.
- Events are sorted into canonical order (global sequence) before folding, so
  the order they are loaded in cannot change the result (ordering invariance).
- Projections never read wall-clock columns (`recorded_at`); domain time
  (`occurred_at`) is part of the event data and stable across replays.
- The event log is immutable: a DB trigger rejects `UPDATE`/`DELETE`.

## Getting started

Requires Node ≥ 20, pnpm, and a local Postgres.

```bash
cp .env.example .env          # adjust connection strings if needed
createdb businessos
createdb businessos_test
pnpm install
pnpm migrate                  # apply migrations to DATABASE_URL
pnpm test                     # runs the kernel test suite
pnpm demo                     # walk through customer + invoice lifecycle by hand
pnpm dev:api                  # http://localhost:3001
```

## Repo layout

```
packages/kernel/                    the deterministic core + business domain (M1 + M2)
packages/modules/accounting-se/     Swedish accounting module (M3) — reuses the kernel's event store
apps/api/                           thin HTTP layer over the kernel + modules, no business logic
infrastructure/migrations/          raw SQL migrations
packages/{workflows,...}            added in later milestones
```

See the milestone plan for what comes next (M4 workflow engine → M5 execution
agents).
