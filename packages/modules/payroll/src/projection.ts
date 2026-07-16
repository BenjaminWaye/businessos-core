/**
 * Projection engine for payroll: events -> PayrollState. Same guarantees as
 * every other module's projection here: pure, canonical-ordered, ignores
 * event types it doesn't recognize.
 */

import { compareEvents, type StoredEvent } from "@businessos/kernel";
import {
  initialPayrollState,
  type Employee,
  type EmployeeAdded,
  type EmployeeTerminated,
  type Payslip,
  type PayslipGenerated,
  type PayrollRun,
  type PayrollRunCreated,
  type PayrollRunFinalized,
  type PayrollState,
} from "./types.js";

function apply(state: PayrollState, event: StoredEvent): PayrollState {
  switch (event.type) {
    case "EmployeeAdded": {
      const p = event.payload as EmployeeAdded;
      const employee: Employee = {
        id: p.employeeId,
        name: p.name,
        email: p.email,
        personalNumber: p.personalNumber,
        birthDate: p.birthDate,
        monthlySalary: p.monthlySalary,
        taxTable: p.taxTable,
        status: "active",
        createdAt: event.occurredAt,
      };
      return { ...state, employees: [...state.employees, employee] };
    }

    case "EmployeeTerminated": {
      const p = event.payload as EmployeeTerminated;
      return {
        ...state,
        employees: state.employees.map((e) => (e.id === p.employeeId ? { ...e, status: "terminated" } : e)),
      };
    }

    case "PayrollRunCreated": {
      const p = event.payload as PayrollRunCreated;
      const run: PayrollRun = {
        id: p.payrollRunId,
        year: p.year,
        month: p.month,
        status: "draft",
        createdAt: event.occurredAt,
        finalizedAt: null,
      };
      return { ...state, payrollRuns: [...state.payrollRuns, run] };
    }

    case "PayrollRunFinalized": {
      const p = event.payload as PayrollRunFinalized;
      return {
        ...state,
        payrollRuns: state.payrollRuns.map((r) =>
          r.id === p.payrollRunId ? { ...r, status: "finalized", finalizedAt: event.occurredAt } : r,
        ),
      };
    }

    case "PayslipGenerated": {
      const p = event.payload as PayslipGenerated;
      const payslip: Payslip = {
        id: p.payslipId,
        payrollRunId: p.payrollRunId,
        employeeId: p.employeeId,
        grossSalary: p.grossSalary,
        taxWithheld: p.taxWithheld,
        netPay: p.netPay,
        employerFee: p.employerFee,
        employerFeeRate: p.employerFeeRate,
        createdAt: event.occurredAt,
      };
      return { ...state, payslips: [...state.payslips, payslip] };
    }

    default:
      return state;
  }
}

export function projectPayroll(events: readonly StoredEvent[]): PayrollState {
  return [...events].sort(compareEvents).reduce(apply, initialPayrollState());
}
