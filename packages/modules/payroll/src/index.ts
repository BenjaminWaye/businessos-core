/**
 * @businessos/payroll — public surface.
 *
 * Employees, monthly payroll runs, payslips. Withholding uses Skatteverket's
 * real published tax tables (2026); employer fees use the real age-banded
 * statutory rates. See withholding.ts and employerFee.ts for sources.
 * Scope: generate -> adjust -> lock. Declaration/payment/ledger booking are
 * a later phase.
 */

export type {
  Employee,
  EmployeeStatus,
  EmployeeAdded,
  EmployeeTerminated,
  PayrollRun,
  PayrollRunStatus,
  PayrollRunCreated,
  PayrollRunFinalized,
  Payslip,
  PayslipGenerated,
  PayrollState,
  PayrollEventMap,
  PayrollEventType,
} from "./types.js";
export { initialPayrollState } from "./types.js";

export { projectPayroll } from "./projection.js";
export { replayPayroll } from "./replay.js";

export { lookupWithholding, suggestTaxTable, listMunicipalities, WITHHOLDING_TABLE_NUMBERS } from "./withholding.js";
export { computeEmployerFee } from "./employerFee.js";
export type { EmployerFeeResult } from "./employerFee.js";

export type {
  CommandDeps,
  AddEmployeeInput,
  TerminateEmployeeInput,
  CreatePayrollRunInput,
  FinalizePayrollRunInput,
  GeneratePayslipInput,
} from "./commands.js";
export { defaultDeps, addEmployee, terminateEmployee, createPayrollRun, finalizePayrollRun, generatePayslip } from "./commands.js";
