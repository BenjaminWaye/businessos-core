/**
 * Income tax withholding — Skatteverket's real published "allmän tabell"
 * (monthly, kolumn 1: ordinary wages for employees under 66 -- the case
 * that covers virtually every payroll employee). Not a formula: the
 * official tables are literal bracket lookups, published as data files for
 * software vendors. Source: data/withholding-tables-2026.json, parsed
 * directly from Skatteverket's own "allmanna-tabeller-manad.txt" (fetched
 * 2026-07-16) per the record layout in their "postbeskrivning" spec.
 *
 * Deliberately scoped to the amount-based ("B") rows, which cover monthly
 * incomes up to 80 000 kr -- effectively every real small-business salary.
 * Above that, Skatteverket's table switches to a percentage-based
 * ("%") format with different lookup semantics that haven't been verified
 * here; `lookupWithholding` throws rather than silently guessing.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface Bracket {
  from: number;
  to: number;
  tax: number;
}

interface WithholdingData {
  source: string;
  fetchedAt: string;
  tables: Record<string, Bracket[]>;
}

const dataPath = fileURLToPath(new URL("./data/withholding-tables-2026.json", import.meta.url));
const WITHHOLDING_DATA = JSON.parse(readFileSync(dataPath, "utf8")) as WithholdingData;

export const WITHHOLDING_TABLE_NUMBERS: readonly number[] = Object.keys(WITHHOLDING_DATA.tables)
  .map(Number)
  .sort((a, b) => a - b);

/**
 * Looks up the monthly withholding amount for a given table number and
 * gross monthly salary (minor units, öre). Table brackets are published in
 * whole kronor, so the lookup happens on the kronor value; the result is
 * converted back to minor units.
 */
export function lookupWithholding(tableNumber: number, grossSalaryMinorUnits: number): number {
  const table = WITHHOLDING_DATA.tables[String(tableNumber)];
  if (!table) {
    throw new Error(
      `lookupWithholding: unknown tax table ${tableNumber} -- valid tables for ${WITHHOLDING_DATA.fetchedAt} are ${WITHHOLDING_TABLE_NUMBERS.join(", ")}`,
    );
  }
  const grossKronor = Math.round(grossSalaryMinorUnits / 100);
  const bracket = table.find((b) => grossKronor >= b.from && grossKronor <= b.to);
  if (!bracket) {
    const maxTo = table[table.length - 1]!.to;
    throw new Error(
      `lookupWithholding: gross salary ${grossKronor} kr is outside the imported table's range (table ${tableNumber} covers up to ${maxTo} kr/month) -- this employee's salary needs the percentage-based table extension, which isn't implemented yet`,
    );
  }
  return bracket.tax * 100;
}

interface MunicipalityData {
  source: string;
  fetchedAt: string;
  municipalities: Record<string, { rateExclChurch: number; suggestedTable: number }>;
}

const municipalityPath = fileURLToPath(new URL("./data/municipality-tax-rates-2026.json", import.meta.url));
const MUNICIPALITY_DATA = JSON.parse(readFileSync(municipalityPath, "utf8")) as MunicipalityData;

/**
 * A convenience suggestion only -- not authoritative. Real table selection
 * can vary by parish (kyrkoavgift) and an employee's actual table is always
 * an explicit, overridable value on the Employee record, never silently
 * derived. Returns undefined for an unrecognized municipality name.
 */
export function suggestTaxTable(municipalityName: string): number | undefined {
  const entry = MUNICIPALITY_DATA.municipalities[municipalityName.trim().toUpperCase()];
  return entry?.suggestedTable;
}

export function listMunicipalities(): string[] {
  return Object.keys(MUNICIPALITY_DATA.municipalities).sort();
}
