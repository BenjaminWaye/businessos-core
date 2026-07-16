/**
 * Arbetsgivaravgifter (employer social fees) -- age-banded statutory rates
 * for 2026, per Skatteverket. Age is evaluated "vid årets ingång" (as of
 * Jan 1 of the payroll run's year), which is how Swedish law defines it --
 * not the employee's age on the pay date itself.
 *
 * Rates (verified via web search against Skatteverket/Ekonomifakta/
 * Fortnox/Driva Företag, 2026):
 *   - born 1937 or earlier: 0% (no employer fee at all)
 *   - 67+ at start of year (born <= year-67): 10.21% (pension contribution only)
 *   - under 18 at start of year: 10.21%
 *   - 18 but not yet 23 at start of year, and the pay period falls within
 *     2026-04-01..2027-09-30 (a temporary reduction): 20.81% on the portion
 *     of gross salary up to 25 000 kr/month, standard 31.42% above that
 *   - everyone else (the common case): 31.42%
 *
 * VÄXA-stöd is deliberately NOT modeled as a rate reduction here: as of the
 * 2026 reform, it no longer reduces the fee paid at payroll time. Employers
 * now pay the full statutory rate and separately apply to Skatteverket for
 * a retroactive monthly refund. That's a claims process against a period
 * that's already been paid, not a payroll calculation -- out of scope for
 * payslip generation.
 */

const STANDARD_RATE = 0.3142;
const REDUCED_RATE = 0.1021; // 67+, under 18
const YOUTH_TEMP_RATE = 0.2081; // 18-22, 2026-04-01..2027-09-30, capped portion
const YOUTH_TEMP_CAP_MINOR_UNITS = 25000_00; // 25 000 kr/month, in öre

const YOUTH_TEMP_WINDOW_START = "2026-04-01";
const YOUTH_TEMP_WINDOW_END = "2027-09-30";

function ageAtStartOfYear(birthDate: string, year: number): number {
  const birthYear = Number(birthDate.slice(0, 4));
  return year - birthYear;
}

function payPeriodWithinYouthWindow(year: number, month: number): boolean {
  const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
  return periodStart >= YOUTH_TEMP_WINDOW_START && periodStart <= YOUTH_TEMP_WINDOW_END;
}

export interface EmployerFeeResult {
  fee: number;
  /** The blended effective rate (fee / grossSalary), for display -- the youth band can mean two rates apply across one salary. */
  effectiveRate: number;
}

/**
 * Computes the employer fee for one payslip. `birthDate` is optional --
 * without it, the standard rate is used (the safe default: it never
 * under-withholds relative to what a company actually owes).
 */
export function computeEmployerFee(
  grossSalaryMinorUnits: number,
  birthDate: string | null,
  payrollYear: number,
  payrollMonth: number,
): EmployerFeeResult {
  if (!birthDate) {
    return { fee: Math.round(grossSalaryMinorUnits * STANDARD_RATE), effectiveRate: STANDARD_RATE };
  }

  const age = ageAtStartOfYear(birthDate, payrollYear);
  const birthYear = Number(birthDate.slice(0, 4));

  if (birthYear <= 1937) {
    return { fee: 0, effectiveRate: 0 };
  }
  if (age >= 67 || age < 18) {
    return { fee: Math.round(grossSalaryMinorUnits * REDUCED_RATE), effectiveRate: REDUCED_RATE };
  }
  if (age < 23 && payPeriodWithinYouthWindow(payrollYear, payrollMonth)) {
    const cappedPortion = Math.min(grossSalaryMinorUnits, YOUTH_TEMP_CAP_MINOR_UNITS);
    const excessPortion = grossSalaryMinorUnits - cappedPortion;
    const fee = Math.round(cappedPortion * YOUTH_TEMP_RATE) + Math.round(excessPortion * STANDARD_RATE);
    return { fee, effectiveRate: grossSalaryMinorUnits > 0 ? fee / grossSalaryMinorUnits : STANDARD_RATE };
  }
  return { fee: Math.round(grossSalaryMinorUnits * STANDARD_RATE), effectiveRate: STANDARD_RATE };
}
