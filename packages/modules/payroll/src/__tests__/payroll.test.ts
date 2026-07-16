/**
 * Payroll command/projection tests (pure — no database).
 */

import { describe, expect, it } from "vitest";
import type { EventDraft, StoredEvent } from "@businessos/kernel";
import { projectPayroll } from "../projection.js";
import {
  addEmployee,
  createPayrollRun,
  finalizePayrollRun,
  generatePayslip,
  terminateEmployee,
} from "../commands.js";
import type { PayrollState } from "../types.js";
import { fixedDeps } from "./helpers.js";

const COMPANY = "acme";

function fold(drafts: EventDraft[]): PayrollState {
  const stored: StoredEvent[] = drafts.map((d, i) => ({ ...d, seq: i + 1 }));
  return projectPayroll(stored);
}

describe("addEmployee", () => {
  it("adds an active employee", () => {
    const draft = addEmployee(
      { companyId: COMPANY, name: "Ada Lovelace", monthlySalary: 35000_00, taxTable: 33 },
      fixedDeps(),
    );
    const state = fold([draft]);
    expect(state.employees).toEqual([
      expect.objectContaining({ name: "Ada Lovelace", monthlySalary: 35000_00, taxTable: 33, status: "active" }),
    ]);
  });

  it("rejects a missing name", () => {
    expect(() => addEmployee({ companyId: COMPANY, name: "", monthlySalary: 1000, taxTable: 33 }, fixedDeps())).toThrow(
      /name is required/,
    );
  });

  it("rejects a non-positive salary", () => {
    expect(() => addEmployee({ companyId: COMPANY, name: "Ada", monthlySalary: 0, taxTable: 33 }, fixedDeps())).toThrow(
      /positive integer/,
    );
  });

  it("rejects an unknown tax table", () => {
    expect(() => addEmployee({ companyId: COMPANY, name: "Ada", monthlySalary: 1000, taxTable: 99 }, fixedDeps())).toThrow(
      /taxTable must be one of/,
    );
  });

  it("rejects a malformed birth date", () => {
    expect(() =>
      addEmployee({ companyId: COMPANY, name: "Ada", monthlySalary: 1000, taxTable: 33, birthDate: "not-a-date" }, fixedDeps()),
    ).toThrow(/ISO date/);
  });
});

describe("terminateEmployee", () => {
  it("terminates an active employee", () => {
    const added = addEmployee({ companyId: COMPANY, name: "Ada", monthlySalary: 1000, taxTable: 33 }, fixedDeps());
    const state = fold([added]);
    const terminated = terminateEmployee(state.employees[0]!, { companyId: COMPANY }, fixedDeps());
    expect(fold([added, terminated]).employees[0]).toMatchObject({ status: "terminated" });
  });

  it("rejects terminating an already-terminated employee", () => {
    const added = addEmployee({ companyId: COMPANY, name: "Ada", monthlySalary: 1000, taxTable: 33 }, fixedDeps());
    const state = fold([added]);
    const terminated = terminateEmployee(state.employees[0]!, { companyId: COMPANY }, fixedDeps());
    const afterState = fold([added, terminated]);
    expect(() => terminateEmployee(afterState.employees[0]!, { companyId: COMPANY }, fixedDeps())).toThrow(
      /already terminated/,
    );
  });
});

describe("createPayrollRun", () => {
  it("creates a draft run", () => {
    const draft = createPayrollRun({ employees: [], payrollRuns: [], payslips: [] }, { companyId: COMPANY, year: 2026, month: 6 }, fixedDeps());
    const state = fold([draft]);
    expect(state.payrollRuns).toEqual([expect.objectContaining({ year: 2026, month: 6, status: "draft" })]);
  });

  it("rejects an invalid month", () => {
    expect(() =>
      createPayrollRun({ employees: [], payrollRuns: [], payslips: [] }, { companyId: COMPANY, year: 2026, month: 13 }, fixedDeps()),
    ).toThrow(/month must be/);
  });

  it("rejects a duplicate period", () => {
    const draft = createPayrollRun({ employees: [], payrollRuns: [], payslips: [] }, { companyId: COMPANY, year: 2026, month: 6 }, fixedDeps());
    const state = fold([draft]);
    expect(() => createPayrollRun(state, { companyId: COMPANY, year: 2026, month: 6 }, fixedDeps())).toThrow(
      /already exists/,
    );
  });
});

describe("finalizePayrollRun", () => {
  it("locks a draft run", () => {
    const created = createPayrollRun({ employees: [], payrollRuns: [], payslips: [] }, { companyId: COMPANY, year: 2026, month: 6 }, fixedDeps());
    const state = fold([created]);
    const finalized = finalizePayrollRun(state.payrollRuns[0]!, { companyId: COMPANY }, fixedDeps());
    expect(fold([created, finalized]).payrollRuns[0]).toMatchObject({ status: "finalized" });
  });

  it("rejects finalizing an already-finalized run", () => {
    const created = createPayrollRun({ employees: [], payrollRuns: [], payslips: [] }, { companyId: COMPANY, year: 2026, month: 6 }, fixedDeps());
    const state = fold([created]);
    const finalized = finalizePayrollRun(state.payrollRuns[0]!, { companyId: COMPANY }, fixedDeps());
    const afterState = fold([created, finalized]);
    expect(() => finalizePayrollRun(afterState.payrollRuns[0]!, { companyId: COMPANY }, fixedDeps())).toThrow(
      /already finalized/,
    );
  });
});

describe("generatePayslip", () => {
  function setup() {
    const added = addEmployee(
      { companyId: COMPANY, name: "Ada", monthlySalary: 6850_00, taxTable: 33 },
      fixedDeps(),
    );
    const created = createPayrollRun({ employees: [], payrollRuns: [], payslips: [] }, { companyId: COMPANY, year: 2026, month: 6 }, fixedDeps());
    const state = fold([added, created]);
    return { added, created, state, employee: state.employees[0]!, run: state.payrollRuns[0]! };
  }

  it("computes gross/tax/net/employer fee from the real tables", () => {
    const { added, created, state, employee, run } = setup();
    const draft = generatePayslip(state, run, employee, { companyId: COMPANY }, fixedDeps());
    const finalState = fold([added, created, draft]);
    expect(finalState.payslips).toEqual([
      expect.objectContaining({
        grossSalary: 6850_00,
        taxWithheld: 578_00, // real published bracket, table 33, 6801-6900kr
        netPay: 6850_00 - 578_00,
        employerFee: Math.round(6850_00 * 0.3142),
      }),
    ]);
  });

  it("rejects generating a second payslip for the same employee in the same run", () => {
    const { added, created, state, employee, run } = setup();
    const draft = generatePayslip(state, run, employee, { companyId: COMPANY }, fixedDeps());
    const afterState = fold([added, created, draft]);
    expect(() => generatePayslip(afterState, run, employee, { companyId: COMPANY }, fixedDeps())).toThrow(
      /already has a payslip/,
    );
  });

  it("rejects generating a payslip against a finalized run", () => {
    const { state, employee, run } = setup();
    const finalizedRun = { ...run, status: "finalized" as const };
    expect(() => generatePayslip(state, finalizedRun, employee, { companyId: COMPANY }, fixedDeps())).toThrow(
      /finalized and can no longer be changed/,
    );
  });

  it("rejects generating a payslip for a terminated employee", () => {
    const { state, employee, run } = setup();
    const terminatedEmployee = { ...employee, status: "terminated" as const };
    expect(() => generatePayslip(state, run, terminatedEmployee, { companyId: COMPANY }, fixedDeps())).toThrow(
      /is not active/,
    );
  });
});
