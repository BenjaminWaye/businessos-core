/**
 * API integration tests.
 *
 * Not a re-test of business rules — the kernel's own test suite already
 * covers those exhaustively (invoice/bill lifecycle, partial payment,
 * overdue derivation, replay). These tests exist to prove the HTTP wiring
 * itself: routes call the right command with the right loaded state, status
 * codes are correct (201 on create, 404 on unknown ids, 400 on validation/
 * rule failures), and a full lifecycle survives a round trip through JSON.
 *
 * Runs Supertest directly against the Express app object (no listening
 * socket), against the real `businessos_test` database.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { newCompanyId, resetEvents, testPool } from "./helpers.js";

const pool = testPool();
const app = createApp(pool);

beforeEach(() => resetEvents(pool));
afterAll(() => pool.end());

describe("customers", () => {
  it("POST /customers creates a customer, GET /customers lists it", async () => {
    const companyId = newCompanyId();
    const created = await request(app)
      .post("/customers")
      .send({ companyId, name: "Ada Lovelace", email: "ada@acme.test" })
      .expect(201);
    expect(created.body.customerId).toEqual(expect.any(String));

    const list = await request(app).get(`/customers?companyId=${companyId}`).expect(200);
    expect(list.body).toEqual([
      expect.objectContaining({ id: created.body.customerId, name: "Ada Lovelace" }),
    ]);
  });

  it("POST /customers without companyId is a 400", async () => {
    const res = await request(app)
      .post("/customers")
      .send({ name: "Ada" })
      .expect(400);
    expect(res.body.error).toMatch(/companyId is required/);
  });
});

describe("invoice lifecycle over HTTP", () => {
  it("create -> send -> partial payment -> full payment -> paid", async () => {
    const companyId = newCompanyId();
    const customer = await request(app)
      .post("/customers")
      .send({ companyId, name: "Ada" })
      .expect(201);

    const invoice = await request(app)
      .post("/invoices")
      .send({
        companyId,
        customerId: customer.body.customerId,
        amount: 100000,
        dueDate: "2026-12-31",
      })
      .expect(201);
    const invoiceId = invoice.body.invoiceId;

    await request(app)
      .post(`/invoices/${invoiceId}/send`)
      .send({ companyId })
      .expect(200)
      .expect((res) => expect(res.body.status).toBe("sent"));

    const partial = await request(app)
      .post("/payments")
      .send({ companyId, invoiceId, amount: 40000 })
      .expect(201);
    expect(partial.body).toMatchObject({ status: "partially_paid", amountPaid: 40000 });

    const full = await request(app)
      .post("/payments")
      .send({ companyId, invoiceId, amount: 60000 })
      .expect(201);
    expect(full.body).toMatchObject({ status: "paid", amountPaid: 100000 });

    const invoices = await request(app).get(`/invoices?companyId=${companyId}`).expect(200);
    expect(invoices.body).toEqual([expect.objectContaining({ id: invoiceId, status: "paid" })]);

    const state = await request(app).get(`/state?companyId=${companyId}`).expect(200);
    expect(state.body.payments).toHaveLength(2);
  });

  it("sending an unknown invoice is a 404", async () => {
    const companyId = newCompanyId();
    await request(app)
      .post(`/invoices/00000000-0000-0000-0000-000000000000/send`)
      .send({ companyId })
      .expect(404);
  });

  it("paying an unknown invoice is a 404", async () => {
    const companyId = newCompanyId();
    await request(app)
      .post("/payments")
      .send({ companyId, invoiceId: "00000000-0000-0000-0000-000000000000", amount: 100 })
      .expect(404);
  });

  it("a payment exceeding the balance is a 400 with the kernel's rule error", async () => {
    const companyId = newCompanyId();
    const customer = await request(app)
      .post("/customers")
      .send({ companyId, name: "Ada" })
      .expect(201);
    const invoice = await request(app)
      .post("/invoices")
      .send({ companyId, customerId: customer.body.customerId, amount: 1000, dueDate: "2026-12-31" })
      .expect(201);
    await request(app).post(`/invoices/${invoice.body.invoiceId}/send`).send({ companyId }).expect(200);

    const res = await request(app)
      .post("/payments")
      .send({ companyId, invoiceId: invoice.body.invoiceId, amount: 5000 })
      .expect(400);
    expect(res.body.error).toMatch(/exceeds remaining balance/);
  });
});

describe("bill lifecycle over HTTP", () => {
  it("receive -> approve -> pay -> paid", async () => {
    const companyId = newCompanyId();
    const supplier = await request(app)
      .post("/suppliers")
      .send({ companyId, name: "Acme Supplies" })
      .expect(201);

    const bill = await request(app)
      .post("/bills")
      .send({ companyId, supplierId: supplier.body.supplierId, amount: 50000, dueDate: "2026-12-31" })
      .expect(201);
    const billId = bill.body.billId;

    await request(app)
      .post(`/bills/${billId}/approve`)
      .send({ companyId })
      .expect(200)
      .expect((res) => expect(res.body.status).toBe("approved"));

    const paid = await request(app)
      .post("/bill-payments")
      .send({ companyId, billId, amount: 50000 })
      .expect(201);
    expect(paid.body).toMatchObject({ status: "paid", amountPaid: 50000 });

    const bills = await request(app).get(`/bills?companyId=${companyId}`).expect(200);
    expect(bills.body).toEqual([expect.objectContaining({ id: billId, status: "paid" })]);
  });

  it("approving an unknown bill is a 404", async () => {
    const companyId = newCompanyId();
    await request(app)
      .post(`/bills/00000000-0000-0000-0000-000000000000/approve`)
      .send({ companyId })
      .expect(404);
  });

  it("paying an unknown bill is a 404", async () => {
    const companyId = newCompanyId();
    await request(app)
      .post("/bill-payments")
      .send({ companyId, billId: "00000000-0000-0000-0000-000000000000", amount: 100 })
      .expect(404);
  });
});

describe("GET /events", () => {
  it("returns the raw event log in canonical order", async () => {
    const companyId = newCompanyId();
    await request(app).post("/customers").send({ companyId, name: "Ada" }).expect(201);
    await request(app).post("/suppliers").send({ companyId, name: "Acme" }).expect(201);

    const events = await request(app).get(`/events?companyId=${companyId}`).expect(200);
    expect(events.body.map((e: { type: string }) => e.type)).toEqual([
      "CustomerCreated",
      "SupplierCreated",
    ]);
    expect(events.body[0]).toEqual(
      expect.objectContaining({ seq: expect.any(Number), id: expect.any(String), companyId }),
    );
  });

  it("without companyId is a 400", async () => {
    await request(app).get("/events").expect(400);
  });
});

describe("GET /accounting/accounts", () => {
  it("returns the curated BAS chart, not company-scoped", async () => {
    const res = await request(app).get("/accounting/accounts").expect(200);
    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "1930", name: "Företagskonto/bank", class: "asset" }),
        expect.objectContaining({ code: "3001", class: "revenue" }),
      ]),
    );
  });
});

describe("GET /accounting/verifications", () => {
  it("lists verifications posted for a company", async () => {
    const companyId = newCompanyId();
    const created = await request(app)
      .post("/accounting/verifications")
      .send({
        companyId,
        series: "A",
        date: "2026-01-15",
        description: "Test entry",
        rows: [
          { account: "1930", debit: 1000, credit: 0 },
          { account: "3001", debit: 0, credit: 1000 },
        ],
      })
      .expect(201);

    const list = await request(app).get(`/accounting/verifications?companyId=${companyId}`).expect(200);
    expect(list.body).toEqual([
      expect.objectContaining({ id: created.body.verificationId, number: created.body.number }),
    ]);
  });
});

describe("task actions", () => {
  async function seedTask(companyId: string) {
    const customer = await request(app).post("/customers").send({ companyId, name: "Ada" }).expect(201);
    const invoice = await request(app)
      .post("/invoices")
      .send({ companyId, customerId: customer.body.customerId, amount: 1000, dueDate: "2026-12-31" })
      .expect(201);
    // Creating an invoice drives invoice-workflow, which creates a SendInvoiceTask.
    const tasks = await request(app).get(`/tasks?companyId=${companyId}`).expect(200);
    return { invoiceId: invoice.body.invoiceId, taskId: tasks.body[0].id };
  }

  it("start -> complete moves a task through created -> in_progress -> completed", async () => {
    const companyId = newCompanyId();
    const { taskId } = await seedTask(companyId);

    const started = await request(app)
      .post(`/tasks/${taskId}/start`)
      .send({ companyId })
      .expect(200);
    expect(started.body).toMatchObject({ id: taskId, status: "in_progress" });

    const completed = await request(app)
      .post(`/tasks/${taskId}/complete`)
      .send({ companyId, output: { sent: true } })
      .expect(200);
    expect(completed.body).toMatchObject({ id: taskId, status: "completed", output: { sent: true } });
  });

  it("completing a task that hasn't been started is a 400", async () => {
    const companyId = newCompanyId();
    const { taskId } = await seedTask(companyId);

    const res = await request(app)
      .post(`/tasks/${taskId}/complete`)
      .send({ companyId })
      .expect(400);
    expect(res.body.error).toMatch(/must be "in_progress"/);
  });

  it("starting an unknown task is a 404", async () => {
    const companyId = newCompanyId();
    await request(app)
      .post("/tasks/00000000-0000-0000-0000-000000000000/start")
      .send({ companyId })
      .expect(404);
  });
});
