/**
 * Verification + fiscal year command/projection tests (pure — no database).
 *
 * Covers the accounting rules from the milestone spec: debit = credit,
 * immutable verifications (reversal instead of edit), sequential voucher
 * numbering, and locked fiscal periods.
 */

import { describe, expect, it } from "vitest";
import type { EventDraft, StoredEvent } from "@businessos/kernel";
import { projectAccounting } from "../projection.js";
import {
  createVerification,
  reverseVerification,
  openFiscalYear,
  closeFiscalYear,
} from "../commands.js";
import type { AccountingState } from "../types.js";
import { initialAccountingState } from "../types.js";
import { fixedDeps } from "./helpers.js";

const COMPANY = "acme";

/**
 * Turn a full history of drafts into state, as if each had been appended and
 * replayed in order. Tests thread state forward by re-folding the accumulated
 * draft list each time a command needs "current state" to validate against —
 * mirrors how a real caller would replay before issuing the next command.
 */
function fold(drafts: EventDraft[]): AccountingState {
  const stored: StoredEvent[] = drafts.map((d, i) => ({ ...d, seq: i + 1 }));
  return projectAccounting(stored);
}

describe("createVerification", () => {
  it("posts a balanced entry", () => {
    const deps = fixedDeps();
    const draft = createVerification(
      initialAccountingState(),
      {
        companyId: COMPANY,
        date: "2026-01-15",
        description: "Cash sale",
        rows: [
          { account: "1930", debit: 10000, credit: 0 },
          { account: "3001", debit: 0, credit: 10000 },
        ],
      },
      deps,
    );
    const state = fold([draft]);
    expect(state.verifications).toHaveLength(1);
    expect(state.verifications[0]).toMatchObject({ series: "A", number: 1, reversed: false });
  });

  it("rejects an unbalanced entry", () => {
    expect(() =>
      createVerification(
        initialAccountingState(),
        {
          companyId: COMPANY,
          date: "2026-01-15",
          description: "Broken",
          rows: [
            { account: "1930", debit: 10000, credit: 0 },
            { account: "3001", debit: 0, credit: 9000 },
          ],
        },
        fixedDeps(),
      ),
    ).toThrow(/unbalanced/);
  });

  it("rejects an unknown account", () => {
    expect(() =>
      createVerification(
        initialAccountingState(),
        {
          companyId: COMPANY,
          date: "2026-01-15",
          description: "Bad account",
          rows: [
            { account: "9999", debit: 100, credit: 0 },
            { account: "3001", debit: 0, credit: 100 },
          ],
        },
        fixedDeps(),
      ),
    ).toThrow(/unknown account/);
  });

  it("rejects a row with both debit and credit set", () => {
    expect(() =>
      createVerification(
        initialAccountingState(),
        {
          companyId: COMPANY,
          date: "2026-01-15",
          description: "Bad row",
          rows: [
            { account: "1930", debit: 100, credit: 100 },
            { account: "3001", debit: 0, credit: 100 },
          ],
        },
        fixedDeps(),
      ),
    ).toThrow(/exactly one of debit\/credit/);
  });

  it("rejects fewer than two rows", () => {
    expect(() =>
      createVerification(
        initialAccountingState(),
        {
          companyId: COMPANY,
          date: "2026-01-15",
          description: "Single row",
          rows: [{ account: "1930", debit: 100, credit: 0 }],
        },
        fixedDeps(),
      ),
    ).toThrow(/at least two rows/);
  });

  it("assigns sequential voucher numbers within a series", () => {
    const deps = fixedDeps();
    const rows = [
      { account: "1930", debit: 100, credit: 0 },
      { account: "3001", debit: 0, credit: 100 },
    ];
    const first = createVerification(
      initialAccountingState(),
      { companyId: COMPANY, date: "2026-01-01", description: "First", rows },
      deps,
    );
    const stateAfterFirst = fold([first]);
    const second = createVerification(
      stateAfterFirst,
      { companyId: COMPANY, date: "2026-01-02", description: "Second", rows },
      deps,
    );
    const stateAfterSecond = fold([first, second]);

    expect(stateAfterFirst.verifications[0]?.number).toBe(1);
    expect(stateAfterSecond.verifications.map((v) => v.number)).toEqual([1, 2]);
  });

  it("voucher numbering is independent per series", () => {
    const deps = fixedDeps();
    const rows = [
      { account: "1930", debit: 100, credit: 0 },
      { account: "3001", debit: 0, credit: 100 },
    ];
    const a1 = createVerification(
      initialAccountingState(),
      { companyId: COMPANY, series: "A", date: "2026-01-01", description: "A1", rows },
      deps,
    );
    let state = fold([a1]);
    const b1 = createVerification(
      state,
      { companyId: COMPANY, series: "B", date: "2026-01-01", description: "B1", rows },
      deps,
    );
    state = fold([a1, b1]);

    const a = state.verifications.find((v) => v.series === "A");
    const b = state.verifications.find((v) => v.series === "B");
    expect(a?.number).toBe(1);
    expect(b?.number).toBe(1);
  });
});

describe("reverseVerification", () => {
  const rows = [
    { account: "1930", debit: 10000, credit: 0 },
    { account: "3001", debit: 0, credit: 10000 },
  ];

  it("posts a mirrored entry and marks the original reversed, without deleting it", () => {
    const deps = fixedDeps();
    const original = createVerification(
      initialAccountingState(),
      { companyId: COMPANY, date: "2026-01-01", description: "Mistake", rows },
      deps,
    );
    let state = fold([original]);
    const originalVerification = state.verifications[0]!;

    const reversal = reverseVerification(
      state,
      originalVerification,
      { companyId: COMPANY, date: "2026-01-02" },
      deps,
    );
    state = fold([original, reversal]);

    expect(state.verifications).toHaveLength(2);
    const orig = state.verifications.find((v) => v.id === originalVerification.id)!;
    const rev = state.verifications.find((v) => v.id !== originalVerification.id)!;
    expect(orig.reversed).toBe(true);
    expect(orig.reversedBy).toBe(rev.id);
    expect(rev.rows).toEqual([
      { account: "1930", debit: 0, credit: 10000 },
      { account: "3001", debit: 10000, credit: 0 },
    ]);
  });

  it("rejects reversing an already-reversed verification", () => {
    const deps = fixedDeps();
    const original = createVerification(
      initialAccountingState(),
      { companyId: COMPANY, date: "2026-01-01", description: "Mistake", rows },
      deps,
    );
    let state = fold([original]);
    const originalVerification = state.verifications[0]!;
    const reversal = reverseVerification(
      state,
      originalVerification,
      { companyId: COMPANY, date: "2026-01-02" },
      deps,
    );
    state = fold([original, reversal]);
    const reversedOriginal = state.verifications.find((v) => v.id === originalVerification.id)!;

    expect(() =>
      reverseVerification(state, reversedOriginal, { companyId: COMPANY, date: "2026-01-03" }, deps),
    ).toThrow(/already reversed/);
  });
});

describe("fiscal years and locked periods", () => {
  const rows = [
    { account: "1930", debit: 100, credit: 0 },
    { account: "3001", debit: 0, credit: 100 },
  ];

  it("rejects posting a verification dated inside a closed fiscal year", () => {
    const deps = fixedDeps();
    const opened = openFiscalYear(
      initialAccountingState(),
      { companyId: COMPANY, startDate: "2026-01-01", endDate: "2026-12-31" },
      deps,
    );
    let state = fold([opened]);
    const fy = state.fiscalYears[0]!;
    const closed = closeFiscalYear(fy, { companyId: COMPANY }, deps);
    state = fold([opened, closed]);

    expect(() =>
      createVerification(
        state,
        { companyId: COMPANY, date: "2026-06-01", description: "Too late", rows },
        deps,
      ),
    ).toThrow(/is closed/);
  });

  it("allows posting outside a closed fiscal year's date range", () => {
    const deps = fixedDeps();
    const opened = openFiscalYear(
      initialAccountingState(),
      { companyId: COMPANY, startDate: "2026-01-01", endDate: "2026-12-31" },
      deps,
    );
    let state = fold([opened]);
    const fy = state.fiscalYears[0]!;
    const closed = closeFiscalYear(fy, { companyId: COMPANY }, deps);
    state = fold([opened, closed]);

    const draft = createVerification(
      state,
      { companyId: COMPANY, date: "2027-01-15", description: "Next year", rows },
      deps,
    );
    expect(draft.payload.date).toBe("2027-01-15");
  });

  it("rejects closing an already-closed fiscal year", () => {
    const deps = fixedDeps();
    const opened = openFiscalYear(
      initialAccountingState(),
      { companyId: COMPANY, startDate: "2026-01-01", endDate: "2026-12-31" },
      deps,
    );
    let state = fold([opened]);
    const fy = state.fiscalYears[0]!;
    const closed = closeFiscalYear(fy, { companyId: COMPANY }, deps);
    state = fold([opened, closed]);
    const closedFy = state.fiscalYears[0]!;

    expect(() => closeFiscalYear(closedFy, { companyId: COMPANY }, deps)).toThrow(/already closed/);
  });

  it("rejects opening an overlapping fiscal year", () => {
    const deps = fixedDeps();
    const opened = openFiscalYear(
      initialAccountingState(),
      { companyId: COMPANY, startDate: "2026-01-01", endDate: "2026-12-31" },
      deps,
    );
    const state = fold([opened]);

    expect(() =>
      openFiscalYear(
        state,
        { companyId: COMPANY, startDate: "2026-06-01", endDate: "2027-06-01" },
        deps,
      ),
    ).toThrow(/overlaps/);
  });
});
