# BusinessOS

A deterministic, event-sourced operating system for running a business: a stable
**kernel** (business truth), pluggable **modules** (accounting, CRM, payroll…),
deterministic **workflows**, and an external **execution layer** of agents that
perform real-world actions. AI interprets — it never decides.

## Status: Milestone 2 — Business Domain Core

On top of the Milestone 1 kernel (event store, command pipeline, projection
engine, replay — still no accounting module, workflows, or AI), the system now
models real business objects:

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
packages/kernel/        the deterministic core + business domain (M1 + M2)
apps/api/                thin HTTP layer over the kernel, no business logic
infrastructure/migrations/  raw SQL migrations
packages/{modules,workflows,...}   added in later milestones
```

See the milestone plan for what comes next (M3 Swedish accounting → M4
workflows → M5 execution agents).
