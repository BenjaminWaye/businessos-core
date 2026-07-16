/**
 * Employer fee tests (pure, no database) -- the age-banded statutory rates
 * from employerFee.ts, verified against the documented sources cited there.
 */

import { describe, expect, it } from "vitest";
import { computeEmployerFee } from "../employerFee.js";

const GROSS = 30000_00; // 30 000 kr

describe("computeEmployerFee", () => {
  it("applies the standard rate (31.42%) with no birth date", () => {
    const result = computeEmployerFee(GROSS, null, 2026, 6);
    expect(result.fee).toBe(Math.round(GROSS * 0.3142));
    expect(result.effectiveRate).toBeCloseTo(0.3142);
  });

  it("applies the standard rate for a typical working-age employee", () => {
    // Born 1990 -> 36 at start of 2026.
    const result = computeEmployerFee(GROSS, "1990-01-01", 2026, 6);
    expect(result.fee).toBe(Math.round(GROSS * 0.3142));
  });

  it("applies the reduced rate (10.21%) for an employee who is 67+ at start of year", () => {
    // Born 1958 -> 68 at start of 2026.
    const result = computeEmployerFee(GROSS, "1958-03-01", 2026, 6);
    expect(result.fee).toBe(Math.round(GROSS * 0.1021));
  });

  it("applies the reduced rate for an employee under 18 at start of year", () => {
    // Born 2010 -> 16 at start of 2026.
    const result = computeEmployerFee(GROSS, "2010-05-01", 2026, 6);
    expect(result.fee).toBe(Math.round(GROSS * 0.1021));
  });

  it("applies zero for someone born 1937 or earlier", () => {
    const result = computeEmployerFee(GROSS, "1937-01-01", 2026, 6);
    expect(result.fee).toBe(0);
    expect(result.effectiveRate).toBe(0);
  });

  it("applies the temporary youth rate within the effective window, capped at 25 000 kr", () => {
    // Born 2004 -> 22 at start of 2026, within the 2026-04-01..2027-09-30 window.
    const highGross = 30000_00;
    const result = computeEmployerFee(highGross, "2004-06-01", 2026, 5);
    const capped = 25000_00;
    const excess = highGross - capped;
    const expectedFee = Math.round(capped * 0.2081) + Math.round(excess * 0.3142);
    expect(result.fee).toBe(expectedFee);
  });

  it("falls back to the standard rate for a youth-band employee outside the effective window", () => {
    // Born 2004 -> 22 at start of 2026, but January 2026 is before the window starts.
    const result = computeEmployerFee(GROSS, "2004-06-01", 2026, 1);
    expect(result.fee).toBe(Math.round(GROSS * 0.3142));
  });
});
