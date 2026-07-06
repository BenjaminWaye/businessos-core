/**
 * Milestone 2 — minimal HTTP surface over the kernel.
 *
 * Thin and deliberately dumb: every route does input parsing -> load any
 * state a command needs -> call the command -> append -> respond with the
 * freshly replayed state. No business logic lives here; it all lives in
 * @businessos/kernel. This is a visualization/integration layer, not a
 * second copy of the domain.
 */

import express, { type Request, type Response, type NextFunction } from "express";
import {
  EventStore,
  replayCompany,
  createCustomer,
  createSupplier,
  createInvoice,
  sendInvoice,
  registerPayment,
  receiveBill,
  approveBill,
  registerBillPayment,
  defaultDeps,
  type Pool,
} from "@businessos/kernel";
import {
  BAS_ACCOUNTS,
  replayAccounting,
  createVerification,
  createAccount,
  openFiscalYear,
  closeFiscalYear,
  trialBalance,
  incomeStatement,
  balanceSheet,
  computeVatReport,
  exportSie4,
  defaultDeps as accountingDefaultDeps,
} from "@businessos/accounting-se";
import {
  reactToEvent,
  replayWorkflows,
  startTask,
  applyTaskResult,
  WORKFLOW_REGISTRY,
  defaultDeps as workflowDefaultDeps,
} from "@businessos/workflows";

export function createApp(pool: Pool): express.Express {
  const store = new EventStore(pool);
  const deps = defaultDeps();
  const accountingDeps = accountingDefaultDeps();
  const workflowDeps = workflowDefaultDeps();
  const app = express();
  app.use(express.json());

  function requireCompanyId(value: unknown): string {
    if (typeof value !== "string" || value.trim() === "") {
      throw new HttpError(400, "companyId is required");
    }
    return value;
  }

  app.post("/customers", asyncRoute(async (req, res) => {
    const { companyId, name, email } = req.body ?? {};
    const draft = createCustomer({ companyId: requireCompanyId(companyId), name, email }, deps);
    await store.append([draft]);
    res.status(201).json({ customerId: draft.payload.customerId });
  }));

  app.get("/customers", asyncRoute(async (req, res) => {
    const companyId = requireCompanyId(req.query["companyId"]);
    const state = await replayCompany(store, companyId);
    res.json(state.customers);
  }));

  app.post("/suppliers", asyncRoute(async (req, res) => {
    const { companyId, name, email } = req.body ?? {};
    const draft = createSupplier({ companyId: requireCompanyId(companyId), name, email }, deps);
    await store.append([draft]);
    res.status(201).json({ supplierId: draft.payload.supplierId });
  }));

  app.post("/invoices", asyncRoute(async (req, res) => {
    const { companyId, customerId, amount, currency, dueDate } = req.body ?? {};
    const draft = createInvoice(
      { companyId: requireCompanyId(companyId), customerId, amount, currency, dueDate },
      deps,
    );
    const [stored] = await store.append([draft]);
    // InvoiceCreated is a workflow trigger — the engine reacts and may post
    // WorkflowStarted/TaskCreated. This route never decides that itself.
    await reactToEvent(store, stored!, WORKFLOW_REGISTRY, workflowDeps);
    res.status(201).json({ invoiceId: draft.payload.invoiceId });
  }));

  app.get("/invoices", asyncRoute(async (req, res) => {
    const companyId = requireCompanyId(req.query["companyId"]);
    const state = await replayCompany(store, companyId);
    res.json(state.invoices);
  }));

  app.post("/invoices/:id/send", asyncRoute(async (req, res) => {
    const companyId = requireCompanyId(req.body?.companyId);
    const state = await replayCompany(store, companyId);
    const invoice = state.invoices.find((i) => i.id === req.params["id"]);
    if (!invoice) throw new HttpError(404, "invoice not found");

    const draft = sendInvoice(invoice, { companyId }, deps);
    const [stored] = await store.append([draft]);
    await reactToEvent(store, stored!, WORKFLOW_REGISTRY, workflowDeps);
    res.status(200).json({ invoiceId: invoice.id, status: "sent" });
  }));

  app.post("/payments", asyncRoute(async (req, res) => {
    const { companyId, invoiceId, amount } = req.body ?? {};
    const company = requireCompanyId(companyId);
    const state = await replayCompany(store, company);
    const invoice = state.invoices.find((i) => i.id === invoiceId);
    if (!invoice) throw new HttpError(404, "invoice not found");

    const draft = registerPayment(invoice, { companyId: company, amount }, deps);
    const [stored] = await store.append([draft]);
    await reactToEvent(store, stored!, WORKFLOW_REGISTRY, workflowDeps);
    const after = await replayCompany(store, company);
    res.status(201).json(after.invoices.find((i) => i.id === invoiceId));
  }));

  app.post("/bills", asyncRoute(async (req, res) => {
    const { companyId, supplierId, amount, currency, dueDate } = req.body ?? {};
    const draft = receiveBill(
      { companyId: requireCompanyId(companyId), supplierId, amount, currency, dueDate },
      deps,
    );
    await store.append([draft]);
    res.status(201).json({ billId: draft.payload.billId });
  }));

  app.get("/bills", asyncRoute(async (req, res) => {
    const companyId = requireCompanyId(req.query["companyId"]);
    const state = await replayCompany(store, companyId);
    res.json(state.bills);
  }));

  app.post("/bills/:id/approve", asyncRoute(async (req, res) => {
    const companyId = requireCompanyId(req.body?.companyId);
    const state = await replayCompany(store, companyId);
    const bill = state.bills.find((b) => b.id === req.params["id"]);
    if (!bill) throw new HttpError(404, "bill not found");

    const draft = approveBill(bill, { companyId }, deps);
    await store.append([draft]);
    res.status(200).json({ billId: bill.id, status: "approved" });
  }));

  app.post("/bill-payments", asyncRoute(async (req, res) => {
    const { companyId, billId, amount } = req.body ?? {};
    const company = requireCompanyId(companyId);
    const state = await replayCompany(store, company);
    const bill = state.bills.find((b) => b.id === billId);
    if (!bill) throw new HttpError(404, "bill not found");

    const draft = registerBillPayment(bill, { companyId: company, amount }, deps);
    await store.append([draft]);
    const after = await replayCompany(store, company);
    res.status(201).json(after.bills.find((b) => b.id === billId));
  }));

  app.get("/accounting/accounts", asyncRoute(async (req, res) => {
    // The static BAS template plus whatever this company has added itself
    // (see POST below) -- company-scoped like every other route, since the
    // custom half of the chart genuinely differs per company.
    const companyId = requireCompanyId(req.query["companyId"]);
    const accounting = await replayAccounting(store, companyId);
    res.json([...BAS_ACCOUNTS, ...accounting.customAccounts]);
  }));

  app.post("/accounting/accounts", asyncRoute(async (req, res) => {
    const { companyId, code, name, class: accountClass } = req.body ?? {};
    const company = requireCompanyId(companyId);
    const accounting = await replayAccounting(store, company);
    const draft = createAccount(accounting, { companyId: company, code, name, class: accountClass }, accountingDeps);
    await store.append([draft]);
    res.status(201).json({ accountId: draft.payload.accountId, code: draft.payload.code });
  }));

  app.get("/accounting/verifications", asyncRoute(async (req, res) => {
    const companyId = requireCompanyId(req.query["companyId"]);
    const accounting = await replayAccounting(store, companyId);
    res.json(accounting.verifications);
  }));

  app.post("/accounting/verifications", asyncRoute(async (req, res) => {
    const { companyId, series, date, description, rows, sourceEventId } = req.body ?? {};
    const company = requireCompanyId(companyId);
    const accounting = await replayAccounting(store, company);
    const draft = createVerification(
      accounting,
      { companyId: company, series, date, description, rows, sourceEventId },
      accountingDeps,
    );
    await store.append([draft]);
    res.status(201).json({ verificationId: draft.payload.verificationId, number: draft.payload.number });
  }));

  app.post("/accounting/fiscal-years", asyncRoute(async (req, res) => {
    const { companyId, startDate, endDate } = req.body ?? {};
    const company = requireCompanyId(companyId);
    const accounting = await replayAccounting(store, company);
    const draft = openFiscalYear(accounting, { companyId: company, startDate, endDate }, accountingDeps);
    await store.append([draft]);
    res.status(201).json({ fiscalYearId: draft.payload.fiscalYearId });
  }));

  app.post("/accounting/fiscal-years/:id/close", asyncRoute(async (req, res) => {
    const companyId = requireCompanyId(req.body?.companyId);
    const accounting = await replayAccounting(store, companyId);
    const fiscalYear = accounting.fiscalYears.find((f) => f.id === req.params["id"]);
    if (!fiscalYear) throw new HttpError(404, "fiscal year not found");

    const draft = closeFiscalYear(fiscalYear, { companyId }, accountingDeps);
    await store.append([draft]);
    res.status(200).json({ fiscalYearId: fiscalYear.id, closed: true });
  }));

  app.get("/accounting/trial-balance", asyncRoute(async (req, res) => {
    const companyId = requireCompanyId(req.query["companyId"]);
    const accounting = await replayAccounting(store, companyId);
    res.json(trialBalance(accounting.verifications));
  }));

  app.get("/accounting/income-statement", asyncRoute(async (req, res) => {
    const companyId = requireCompanyId(req.query["companyId"]);
    const accounting = await replayAccounting(store, companyId);
    res.json(incomeStatement(accounting.verifications));
  }));

  app.get("/accounting/balance-sheet", asyncRoute(async (req, res) => {
    const companyId = requireCompanyId(req.query["companyId"]);
    const accounting = await replayAccounting(store, companyId);
    res.json(balanceSheet(accounting.verifications));
  }));

  app.get("/accounting/vat-report", asyncRoute(async (req, res) => {
    const companyId = requireCompanyId(req.query["companyId"]);
    const periodStart = String(req.query["periodStart"] ?? "");
    const periodEnd = String(req.query["periodEnd"] ?? "");
    const accounting = await replayAccounting(store, companyId);
    res.json(computeVatReport(accounting.verifications, periodStart, periodEnd));
  }));

  app.get("/accounting/sie", asyncRoute(async (req, res) => {
    const companyId = requireCompanyId(req.query["companyId"]);
    const fiscalYearId = String(req.query["fiscalYearId"] ?? "");
    const orgNumber = String(req.query["orgNumber"] ?? "");
    const name = String(req.query["name"] ?? "");
    const accounting = await replayAccounting(store, companyId);
    const fiscalYear = accounting.fiscalYears.find((f) => f.id === fiscalYearId);
    if (!fiscalYear) throw new HttpError(404, "fiscal year not found");

    const text = exportSie4(
      { orgNumber, name },
      { startDate: fiscalYear.startDate, endDate: fiscalYear.endDate },
      accounting.verifications,
    );
    res.type("text/plain").send(text);
  }));

  app.get("/workflows", asyncRoute(async (req, res) => {
    const companyId = requireCompanyId(req.query["companyId"]);
    const workflows = await replayWorkflows(store, companyId);
    res.json(workflows.instances);
  }));

  app.get("/tasks", asyncRoute(async (req, res) => {
    const companyId = requireCompanyId(req.query["companyId"]);
    const workflows = await replayWorkflows(store, companyId);
    res.json(workflows.tasks);
  }));

  app.post("/tasks/:id/start", asyncRoute(async (req, res) => {
    const companyId = requireCompanyId(req.body?.companyId);
    const workflows = await replayWorkflows(store, companyId);
    const task = workflows.tasks.find((t) => t.id === req.params["id"]);
    if (!task) throw new HttpError(404, "task not found");

    const draft = startTask(task, { companyId }, workflowDeps);
    await store.append([draft]);
    const after = await replayWorkflows(store, companyId);
    res.status(200).json(after.tasks.find((t) => t.id === task.id));
  }));

  app.post("/tasks/:id/complete", asyncRoute(async (req, res) => {
    const companyId = requireCompanyId(req.body?.companyId);
    const workflows = await replayWorkflows(store, companyId);
    const task = workflows.tasks.find((t) => t.id === req.params["id"]);
    if (!task) throw new HttpError(404, "task not found");

    const draft = applyTaskResult(
      task,
      { companyId, result: { taskId: task.id, status: "completed", output: req.body?.output } },
      workflowDeps,
    );
    await store.append([draft]);
    const after = await replayWorkflows(store, companyId);
    res.status(200).json(after.tasks.find((t) => t.id === task.id));
  }));

  app.get("/events", asyncRoute(async (req, res) => {
    const companyId = requireCompanyId(req.query["companyId"]);
    res.json(await store.byCompany(companyId));
  }));

  app.get("/state", asyncRoute(async (req, res) => {
    const companyId = requireCompanyId(req.query["companyId"]);
    res.json(await replayCompany(store, companyId));
  }));

  app.use(errorHandler);
  return app;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Wrap an async Express handler so rejected promises reach the error handler. */
function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof Error) {
    // Command validation errors (bad amount, wrong invoice status, etc.) are
    // thrown as plain Errors by the kernel — treat them as client errors.
    res.status(400).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: "internal error" });
}
