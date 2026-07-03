/**
 * SIE4 export tests (pure — no database). Checks structure, not a full SIE
 * grammar validation (see sie.ts docstring for the MVP caveat).
 */

import { describe, expect, it } from "vitest";
import { exportSie4 } from "../sie.js";
import type { Verification } from "../types.js";

const verifications: Verification[] = [
  {
    id: "1",
    series: "A",
    number: 1,
    date: "2026-02-01",
    description: "Cash sale",
    rows: [
      { account: "1930", debit: 10000, credit: 0 },
      { account: "3001", debit: 0, credit: 10000 },
    ],
    sourceEventId: null,
    reversed: false,
    reversedBy: null,
    createdAt: "2026-02-01T00:00:00.000Z",
  },
];

describe("exportSie4", () => {
  it("includes the SIE4 header markers", () => {
    const text = exportSie4(
      { orgNumber: "556677-8899", name: "Acme AB" },
      { startDate: "2026-01-01", endDate: "2026-12-31" },
      verifications,
    );
    expect(text).toContain("#SIETYP 4");
    expect(text).toContain("#ORGNR 556677-8899");
    expect(text).toContain('#FNAMN "Acme AB"');
    expect(text).toContain("#RAR 0 20260101 20261231");
  });

  it("emits one #KONTO per account used, and one #VER per verification", () => {
    const text = exportSie4(
      { orgNumber: "556677-8899", name: "Acme AB" },
      { startDate: "2026-01-01", endDate: "2026-12-31" },
      verifications,
    );
    expect((text.match(/#KONTO/g) ?? []).length).toBe(2); // 1930, 3001
    expect((text.match(/#VER/g) ?? []).length).toBe(1);
    expect((text.match(/#TRANS/g) ?? []).length).toBe(2);
  });

  it("converts minor units to a decimal amount string", () => {
    const text = exportSie4(
      { orgNumber: "556677-8899", name: "Acme AB" },
      { startDate: "2026-01-01", endDate: "2026-12-31" },
      verifications,
    );
    expect(text).toContain("100.00"); // 10000 öre -> 100.00 kr
    expect(text).toContain("-100.00");
  });

  it("produces an empty-but-valid header for no verifications", () => {
    const text = exportSie4(
      { orgNumber: "556677-8899", name: "Acme AB" },
      { startDate: "2026-01-01", endDate: "2026-12-31" },
      [],
    );
    expect(text).toContain("#SIETYP 4");
    expect(text).not.toContain("#VER");
  });
});
