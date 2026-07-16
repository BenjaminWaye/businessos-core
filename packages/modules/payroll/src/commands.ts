/**
 * Command -> event pipeline for payroll. Same shape as every other module
 * in this repo: pure functions, no DB access, commands that validate a
 * transition take the current entity (loaded by the caller via replay).
 */

import { randomUUID } from "node:crypto";
import type { EventDraft } from "@businessos/kernel";
import { computeEmployerFee } from "./employerFee.js";
import { lookupWithholding, WITHHOLDING_TABLE_NUMBERS } from "./withholding.js";
import type {
  Employee,
  EmployeeAdded,
  EmployeeTerminated,
  PayrollRun,
  PayrollRunCreated,
  PayrollRunFinalized,
  PayrollState,
  PayslipGenerated,
} from "./types.js";

export interface CommandDeps {
  newId: () => string;
  now: () => string;
}

export function defaultDeps(): CommandDeps {
  return { newId: () => randomUUID(), now: () => new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

export interface AddEmployeeInput {
  companyId: string;
  name: string;
  email?: string | null;
  personalNumber?: string | null;
  birthDate?: string | null;
  monthlySalary: number;
  taxTable: number;
}

export function addEmployee(input: AddEmployeeInput, deps: CommandDeps): EventDraft<EmployeeAdded> {
  if (!input.name?.trim()) {
    throw new Error("addEmployee: name is required");
  }
  if (!Number.isInteger(input.monthlySalary) || input.monthlySalary <= 0) {
    throw new Error("addEmployee: monthlySalary must be a positive integer (minor units)");
  }
  if (!WITHHOLDING_TABLE_NUMBERS.includes(input.taxTable)) {
    throw new Error(`addEmployee: taxTable must be one of ${WITHHOLDING_TABLE_NUMBERS.join(", ")}`);
  }
  if (input.birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.birthDate)) {
    throw new Error("addEmployee: birthDate must be an ISO date (YYYY-MM-DD)");
  }

  return {
    id: deps.newId(),
    companyId: input.companyId,
    type: "EmployeeAdded",
    occurredAt: deps.now(),
    payload: {
      employeeId: deps.newId(),
      name: input.name.trim(),
      email: input.email?.trim() || null,
      personalNumber: input.personalNumber?.trim() || null,
      birthDate: input.birthDate ?? null,
      monthlySalary: input.monthlySalary,
      taxTable: input.taxTable,
    },
  };
}

export interface TerminateEmployeeInput {
  companyId: string;
}

export function terminateEmployee(
  employee: Employee,
  input: TerminateEmployeeInput,
  deps: CommandDeps,
): EventDraft<EmployeeTerminated> {
  if (employee.status !== "active") {
    throw new Error(`terminateEmployee: employee ${employee.id} is already terminated`);
  }
  return {
    id: deps.newId(),
    companyId: input.companyId,
    type: "EmployeeTerminated",
    occurredAt: deps.now(),
    payload: { employeeId: employee.id },
  };
}

// ---------------------------------------------------------------------------
// Payroll runs
// ---------------------------------------------------------------------------

export interface CreatePayrollRunInput {
  companyId: string;
  year: number;
  month: number;
}

export function createPayrollRun(
  state: PayrollState,
  input: CreatePayrollRunInput,
  deps: CommandDeps,
): EventDraft<PayrollRunCreated> {
  if (!Number.isInteger(input.month) || input.month < 1 || input.month > 12) {
    throw new Error("createPayrollRun: month must be an integer 1-12");
  }
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) {
    throw new Error("createPayrollRun: year looks invalid");
  }
  const exists = state.payrollRuns.some((r) => r.year === input.year && r.month === input.month);
  if (exists) {
    throw new Error(`createPayrollRun: a payroll run for ${input.year}-${String(input.month).padStart(2, "0")} already exists`);
  }

  return {
    id: deps.newId(),
    companyId: input.companyId,
    type: "PayrollRunCreated",
    occurredAt: deps.now(),
    payload: { payrollRunId: deps.newId(), year: input.year, month: input.month },
  };
}

export interface FinalizePayrollRunInput {
  companyId: string;
}

/** Locks a run -- like closing a fiscal year, this is a one-way transition. */
export function finalizePayrollRun(
  run: PayrollRun,
  input: FinalizePayrollRunInput,
  deps: CommandDeps,
): EventDraft<PayrollRunFinalized> {
  if (run.status !== "draft") {
    throw new Error(`finalizePayrollRun: run ${run.id} is already finalized`);
  }
  return {
    id: deps.newId(),
    companyId: input.companyId,
    type: "PayrollRunFinalized",
    occurredAt: deps.now(),
    payload: { payrollRunId: run.id },
  };
}

// ---------------------------------------------------------------------------
// Payslips
// ---------------------------------------------------------------------------

export interface GeneratePayslipInput {
  companyId: string;
}

/**
 * GeneratePayslip -> PayslipGenerated. Pure calculation from the employee's
 * current salary/table/birthdate and the run's period -- withholding via
 * the real imported Skatteverket table (withholding.ts), employer fee via
 * the real age-banded rates (employerFee.ts). Neither is invented here.
 */
export function generatePayslip(
  state: PayrollState,
  run: PayrollRun,
  employee: Employee,
  input: GeneratePayslipInput,
  deps: CommandDeps,
): EventDraft<PayslipGenerated> {
  if (run.status !== "draft") {
    throw new Error(`generatePayslip: run ${run.id} is finalized and can no longer be changed`);
  }
  if (employee.status !== "active") {
    throw new Error(`generatePayslip: employee ${employee.id} is not active`);
  }
  const alreadyGenerated = state.payslips.some((p) => p.payrollRunId === run.id && p.employeeId === employee.id);
  if (alreadyGenerated) {
    throw new Error(`generatePayslip: employee ${employee.id} already has a payslip in run ${run.id}`);
  }

  const gross = employee.monthlySalary;
  const tax = lookupWithholding(employee.taxTable, gross);
  const net = gross - tax;
  const { fee, effectiveRate } = computeEmployerFee(gross, employee.birthDate, run.year, run.month);

  return {
    id: deps.newId(),
    companyId: input.companyId,
    type: "PayslipGenerated",
    occurredAt: deps.now(),
    payload: {
      payslipId: deps.newId(),
      payrollRunId: run.id,
      employeeId: employee.id,
      grossSalary: gross,
      taxWithheld: tax,
      netPay: net,
      employerFee: fee,
      employerFeeRate: effectiveRate,
    },
  };
}
