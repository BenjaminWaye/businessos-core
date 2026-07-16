/**
 * Payroll — employees, monthly payroll runs, payslips.
 *
 * Scope for this milestone: generate -> adjust -> lock (the "step 1" of a
 * real payroll run). Declaring to Skatteverket, paying the withheld tax and
 * employer fees, and booking the run to the ledger are deliberately NOT
 * covered here — they're a separate, later phase, since they involve a real
 * external integration with Skatteverket's e-services rather than pure
 * calculation.
 *
 * Income tax withholding uses Skatteverket's actual published "allmän
 * tabell" (monthly, column 1 — ordinary wages, employees under 66) bracket
 * data, not an invented formula: see data/withholding-tables-2026.json and
 * withholding.ts. Employer fees use the real age-banded statutory rates:
 * see employerFee.ts for citations. Neither is fabricated.
 */

export type EmployeeStatus = "active" | "terminated";

export interface Employee {
  id: string;
  name: string;
  email: string | null;
  personalNumber: string | null;
  /** ISO date (YYYY-MM-DD). Drives the age-banded employer fee rate; without it, the standard 31.42% rate is used. */
  birthDate: string | null;
  /** Minor currency units (öre), same convention as every other amount in the system. */
  monthlySalary: number;
  /** Skatteverket "allmän tabell" number (29-42 for 2026), column 1. See data/withholding-tables-2026.json. */
  taxTable: number;
  status: EmployeeStatus;
  createdAt: string;
}

export interface EmployeeAdded {
  employeeId: string;
  name: string;
  email: string | null;
  personalNumber: string | null;
  birthDate: string | null;
  monthlySalary: number;
  taxTable: number;
}

export interface EmployeeTerminated {
  employeeId: string;
}

export type PayrollRunStatus = "draft" | "finalized";

export interface PayrollRun {
  id: string;
  year: number;
  month: number;
  status: PayrollRunStatus;
  createdAt: string;
  finalizedAt: string | null;
}

export interface PayrollRunCreated {
  payrollRunId: string;
  year: number;
  month: number;
}

export interface PayrollRunFinalized {
  payrollRunId: string;
}

export interface Payslip {
  id: string;
  payrollRunId: string;
  employeeId: string;
  /** Minor currency units. */
  grossSalary: number;
  taxWithheld: number;
  netPay: number;
  employerFee: number;
  /** The rate actually applied, as a fraction (e.g. 0.3142) -- captured on the event so a later change in statutory rates never rewrites history. */
  employerFeeRate: number;
  createdAt: string;
}

export interface PayslipGenerated {
  payslipId: string;
  payrollRunId: string;
  employeeId: string;
  grossSalary: number;
  taxWithheld: number;
  netPay: number;
  employerFee: number;
  employerFeeRate: number;
}

export interface PayrollState {
  employees: Employee[];
  payrollRuns: PayrollRun[];
  payslips: Payslip[];
}

export function initialPayrollState(): PayrollState {
  return { employees: [], payrollRuns: [], payslips: [] };
}

export interface PayrollEventMap {
  EmployeeAdded: EmployeeAdded;
  EmployeeTerminated: EmployeeTerminated;
  PayrollRunCreated: PayrollRunCreated;
  PayrollRunFinalized: PayrollRunFinalized;
  PayslipGenerated: PayslipGenerated;
}

export type PayrollEventType = keyof PayrollEventMap;
