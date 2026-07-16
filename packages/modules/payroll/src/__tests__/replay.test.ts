/**
 * Replay test (DB-backed) — proves the full loop against real Postgres:
 * commands -> append -> event log -> replayPayroll -> identical state.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { EventStore, type Pool } from "@businessos/kernel";
import { addEmployee, createPayrollRun, defaultDeps, finalizePayrollRun, generatePayslip } from "../commands.js";
import { replayPayroll } from "../replay.js";
import { resetEvents, testPool } from "./helpers.js";

const pool: Pool = testPool();
const store = new EventStore(pool);

beforeEach(() => resetEvents(pool));
afterAll(() => pool.end());

const COMPANY = "00000000-0000-0000-0000-000000000070";

describe("replayPayroll", () => {
  it("rebuilds an employee, a run, and a payslip from the event log", async () => {
    const deps = defaultDeps();

    const employeeDraft = addEmployee(
      { companyId: COMPANY, name: "Ada Lovelace", monthlySalary: 35000_00, taxTable: 33, birthDate: "1990-01-01" },
      deps,
    );
    await store.append([employeeDraft]);

    const runDraft = createPayrollRun(await replayPayroll(store, COMPANY), { companyId: COMPANY, year: 2026, month: 6 }, deps);
    await store.append([runDraft]);

    let state = await replayPayroll(store, COMPANY);
    expect(state.employees).toHaveLength(1);
    expect(state.payrollRuns).toHaveLength(1);

    const payslipDraft = generatePayslip(state, state.payrollRuns[0]!, state.employees[0]!, { companyId: COMPANY }, deps);
    await store.append([payslipDraft]);

    state = await replayPayroll(store, COMPANY);
    expect(state.payslips).toHaveLength(1);
    expect(state.payslips[0]).toMatchObject({ grossSalary: 35000_00 });

    const finalizeDraft = finalizePayrollRun(state.payrollRuns[0]!, { companyId: COMPANY }, deps);
    await store.append([finalizeDraft]);

    state = await replayPayroll(store, COMPANY);
    expect(state.payrollRuns[0]).toMatchObject({ status: "finalized" });
  });

  it("keeps companies isolated", async () => {
    const deps = defaultDeps();
    const otherCompany = "00000000-0000-0000-0000-000000000071";

    await store.append([addEmployee({ companyId: COMPANY, name: "Ada", monthlySalary: 1000, taxTable: 33 }, deps)]);
    await store.append([addEmployee({ companyId: otherCompany, name: "Bob", monthlySalary: 2000, taxTable: 33 }, deps)]);

    const state = await replayPayroll(store, COMPANY);
    expect(state.employees).toHaveLength(1);
    expect(state.employees[0]!.name).toBe("Ada");
  });
});
