/**
 * createAccount command + projection tests (pure — no database).
 *
 * Covers a company's own additions to the static BAS template: valid custom
 * accounts fold into state, invalid ones are rejected, and createVerification
 * accepts postings against a custom account once it exists (and still
 * rejects codes nobody has created).
 */

import { describe, expect, it } from "vitest";
import type { EventDraft, StoredEvent } from "@businessos/kernel";
import { projectAccounting } from "../projection.js";
import { createAccount, createVerification } from "../commands.js";
import type { AccountingState } from "../types.js";
import { initialAccountingState } from "../types.js";
import { fixedDeps } from "./helpers.js";

const COMPANY = "acme";

function fold(drafts: EventDraft[]): AccountingState {
  const stored: StoredEvent[] = drafts.map((d, i) => ({ ...d, seq: i + 1 }));
  return projectAccounting(stored);
}

describe("createAccount", () => {
  it("adds a custom account to state", () => {
    const draft = createAccount(
      initialAccountingState(),
      { companyId: COMPANY, code: "1931", name: "Savings account", class: "asset" },
      fixedDeps(),
    );
    const state = fold([draft]);
    expect(state.customAccounts).toEqual([
      expect.objectContaining({ code: "1931", name: "Savings account", class: "asset" }),
    ]);
  });

  it("rejects a code already in the static BAS template", () => {
    expect(() =>
      createAccount(initialAccountingState(), { companyId: COMPANY, code: "1930", name: "Dup", class: "asset" }, fixedDeps()),
    ).toThrow(/already exists/);
  });

  it("rejects a code already added as a custom account", () => {
    const first = createAccount(
      initialAccountingState(),
      { companyId: COMPANY, code: "1931", name: "Savings account", class: "asset" },
      fixedDeps(),
    );
    const state = fold([first]);
    expect(() =>
      createAccount(state, { companyId: COMPANY, code: "1931", name: "Different name", class: "asset" }, fixedDeps()),
    ).toThrow(/already exists/);
  });

  it("rejects a malformed code", () => {
    expect(() =>
      createAccount(initialAccountingState(), { companyId: COMPANY, code: "abc", name: "Bad", class: "asset" }, fixedDeps()),
    ).toThrow(/4-digit/);
  });

  it("rejects an empty name", () => {
    expect(() =>
      createAccount(initialAccountingState(), { companyId: COMPANY, code: "1931", name: "  ", class: "asset" }, fixedDeps()),
    ).toThrow(/name is required/);
  });

  it("rejects an invalid class", () => {
    expect(() =>
      createAccount(
        initialAccountingState(),
        // @ts-expect-error -- deliberately invalid to exercise the runtime check
        { companyId: COMPANY, code: "1931", name: "Savings account", class: "bogus" },
        fixedDeps(),
      ),
    ).toThrow(/unknown class/);
  });
});

describe("createVerification against a custom account", () => {
  it("posts once the account has been created", () => {
    const accountDraft = createAccount(
      initialAccountingState(),
      { companyId: COMPANY, code: "1931", name: "Savings account", class: "asset" },
      fixedDeps(),
    );
    const state = fold([accountDraft]);

    const verificationDraft = createVerification(
      state,
      {
        companyId: COMPANY,
        date: "2026-01-15",
        description: "Transfer to savings",
        rows: [
          { account: "1930", debit: 0, credit: 10000 },
          { account: "1931", debit: 10000, credit: 0 },
        ],
      },
      fixedDeps(),
    );
    expect(() => fold([accountDraft, verificationDraft])).not.toThrow();
    expect(fold([accountDraft, verificationDraft]).verifications).toHaveLength(1);
  });

  it("still rejects a posting against a code nobody created", () => {
    expect(() =>
      createVerification(
        initialAccountingState(),
        {
          companyId: COMPANY,
          date: "2026-01-15",
          description: "Transfer to savings",
          rows: [
            { account: "1930", debit: 0, credit: 10000 },
            { account: "1932", debit: 10000, credit: 0 },
          ],
        },
        fixedDeps(),
      ),
    ).toThrow(/unknown account/);
  });
});
