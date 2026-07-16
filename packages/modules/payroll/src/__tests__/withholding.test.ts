/**
 * Withholding lookup tests (pure, no database).
 *
 * Values asserted here were read directly from Skatteverket's raw
 * allmanna-tabeller-manad.txt (table 33, column 1) during import -- not
 * independently computed, so this is really a regression test that the
 * parser/lookup reproduces the source file faithfully.
 */

import { describe, expect, it } from "vitest";
import { lookupWithholding, suggestTaxTable, WITHHOLDING_TABLE_NUMBERS } from "../withholding.js";

describe("WITHHOLDING_TABLE_NUMBERS", () => {
  it("covers the 2026 table range published by Skatteverket", () => {
    expect(WITHHOLDING_TABLE_NUMBERS).toEqual([29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42]);
  });
});

describe("lookupWithholding", () => {
  it("returns 0 for income in the lowest bracket (table 33, 1-2000 kr)", () => {
    expect(lookupWithholding(33, 1500_00)).toBe(0);
  });

  it("matches the real published bracket (table 33, 6801-6900 kr -> 578 kr)", () => {
    expect(lookupWithholding(33, 6850_00)).toBe(578_00);
  });

  it("matches the real published bracket at the boundary (table 33, 79801-80000 kr -> 26595 kr)", () => {
    expect(lookupWithholding(33, 80000_00)).toBe(26595_00);
  });

  it("throws for an unknown table number", () => {
    expect(() => lookupWithholding(99, 30000_00)).toThrow(/unknown tax table/);
  });

  it("throws for a salary above the imported table's range", () => {
    expect(() => lookupWithholding(33, 90000_00)).toThrow(/outside the imported table's range/);
  });
});

describe("suggestTaxTable", () => {
  it("suggests a real table number for a real municipality", () => {
    expect(suggestTaxTable("UPPSALA")).toBe(33);
    expect(suggestTaxTable("uppsala")).toBe(33); // case-insensitive
  });

  it("returns undefined for an unrecognized name", () => {
    expect(suggestTaxTable("NARNIA")).toBeUndefined();
  });
});
