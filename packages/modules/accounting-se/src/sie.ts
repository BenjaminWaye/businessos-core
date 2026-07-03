/**
 * SIE4 export (MVP).
 *
 * Produces a structurally correct SIE4-shaped text file — account
 * definitions (#KONTO) and verifications (#VER/#TRANS) — proving the export
 * pipeline exists end-to-end. This is NOT a certified/complete SIE4
 * implementation (real SIE4 requires CP437 encoding, full header block,
 * balance carry-forward records, etc.); treat it as a starting point.
 */

import { findAccount } from "./accounts.js";
import type { Verification } from "./types.js";

export interface SieCompanyInfo {
  orgNumber: string;
  name: string;
}

export interface SieFiscalYear {
  startDate: string;
  endDate: string;
}

function sieDate(isoDate: string): string {
  return isoDate.replace(/-/g, "").slice(0, 8);
}

function sieAmount(minorUnits: number): string {
  return (minorUnits / 100).toFixed(2);
}

/** Escape a value for a SIE quoted field: SIE uses backslash-escaped quotes. */
function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function exportSie4(
  company: SieCompanyInfo,
  fiscalYear: SieFiscalYear,
  verifications: readonly Verification[],
): string {
  const lines: string[] = [];

  lines.push("#FLAGGA 0");
  lines.push(`#PROGRAM ${quote("BusinessOS")} 1.0`);
  lines.push("#FORMAT PC8");
  lines.push(`#GEN ${sieDate(new Date().toISOString())}`);
  lines.push("#SIETYP 4");
  lines.push(`#ORGNR ${company.orgNumber}`);
  lines.push(`#FNAMN ${quote(company.name)}`);
  lines.push(`#RAR 0 ${sieDate(fiscalYear.startDate)} ${sieDate(fiscalYear.endDate)}`);

  const accountCodes = [...new Set(verifications.flatMap((v) => v.rows.map((r) => r.account)))].sort();
  for (const code of accountCodes) {
    lines.push(`#KONTO ${code} ${quote(findAccount(code)?.name ?? code)}`);
  }

  for (const v of verifications) {
    lines.push(`#VER ${quote(v.series)} ${quote(String(v.number))} ${sieDate(v.date)} ${quote(v.description)}`);
    lines.push("{");
    for (const row of v.rows) {
      const amount = row.debit > 0 ? row.debit : -row.credit;
      lines.push(`   #TRANS ${row.account} {} ${sieAmount(amount)}`);
    }
    lines.push("}");
  }

  return lines.join("\r\n") + "\r\n";
}
