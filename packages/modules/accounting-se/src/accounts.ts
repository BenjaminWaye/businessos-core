/**
 * BAS chart of accounts (Sweden).
 *
 * A curated subset of the real BAS 2025 standard, covering the accounts a
 * typical small company posts against day to day (bank/cash, receivables/
 * payables, common revenue and cost categories, VAT, payroll, equity). Not
 * the full ~300-account chart; a real company's chart of accounts would be
 * configured, not hardcoded, but this covers common bookkeeping without
 * requiring every company to know obscure codes. This is a lookup table for
 * display (name/classification) only — `createVerification` accepts any
 * account code string; codes outside this list still post fine, just
 * without a friendly name in reports (see `findAccount`/`accountClass`).
 *
 * BAS account numbers are structured by leading digit:
 *   1xxx assets, 2xxx equity & liabilities, 3xxx revenue, 4-7xxx costs,
 *   8xxx financial items / appropriations / tax.
 */

export type AccountClass = "asset" | "equity_liability" | "revenue" | "cost" | "financial";

export interface BasAccount {
  code: string;
  name: string;
  class: AccountClass;
}

export const BAS_ACCOUNTS: readonly BasAccount[] = [
  // 1xxx — assets
  { code: "1210", name: "Maskiner och andra tekniska anläggningar", class: "asset" },
  { code: "1220", name: "Inventarier och verktyg", class: "asset" },
  { code: "1230", name: "Installationer", class: "asset" },
  { code: "1240", name: "Bilar och andra transportmedel", class: "asset" },
  { code: "1400", name: "Lager", class: "asset" },
  { code: "1510", name: "Kundfordringar", class: "asset" },
  { code: "1630", name: "Avräkning för skatter och avgifter (skattekonto)", class: "asset" },
  { code: "1640", name: "Skattefordringar", class: "asset" },
  { code: "1650", name: "Momsfordran", class: "asset" },
  { code: "1680", name: "Andra kortfristiga fordringar", class: "asset" },
  { code: "1710", name: "Förutbetalda hyreskostnader", class: "asset" },
  { code: "1790", name: "Övriga förutbetalda kostnader och upplupna intäkter", class: "asset" },
  { code: "1910", name: "Kassa", class: "asset" },
  { code: "1930", name: "Företagskonto/bank", class: "asset" },
  { code: "1940", name: "Övriga bankkonton", class: "asset" },

  // 2xxx — equity & liabilities
  { code: "2081", name: "Aktiekapital", class: "equity_liability" },
  { code: "2091", name: "Balanserad vinst eller förlust", class: "equity_liability" },
  { code: "2099", name: "Årets resultat", class: "equity_liability" },
  { code: "2330", name: "Checkräkningskredit", class: "equity_liability" },
  { code: "2350", name: "Andra långfristiga skulder till kreditinstitut", class: "equity_liability" },
  { code: "2440", name: "Leverantörsskulder", class: "equity_liability" },
  { code: "2510", name: "Skatteskulder", class: "equity_liability" },
  { code: "2610", name: "Utgående moms, 25%", class: "equity_liability" },
  { code: "2611", name: "Utgående moms 25%", class: "equity_liability" },
  { code: "2620", name: "Utgående moms, 12%", class: "equity_liability" },
  { code: "2630", name: "Utgående moms, 6%", class: "equity_liability" },
  { code: "2640", name: "Ingående moms", class: "equity_liability" },
  { code: "2641", name: "Ingående moms 25%", class: "equity_liability" },
  { code: "2650", name: "Redovisningskonto för moms", class: "equity_liability" },
  { code: "2710", name: "Personalskatt", class: "equity_liability" },
  { code: "2730", name: "Lagstadgade sociala avgifter", class: "equity_liability" },
  { code: "2740", name: "Beräknad upplupen särskild löneskatt", class: "equity_liability" },
  { code: "2890", name: "Övriga kortfristiga skulder", class: "equity_liability" },
  { code: "2910", name: "Upplupna löner", class: "equity_liability" },
  { code: "2940", name: "Upplupna lagstadgade sociala avgifter", class: "equity_liability" },
  { code: "2990", name: "Övriga upplupna kostnader och förutbetalda intäkter", class: "equity_liability" },

  // 3xxx — revenue
  { code: "3001", name: "Försäljning inom Sverige, 25% moms", class: "revenue" },
  { code: "3002", name: "Försäljning inom Sverige, 12% moms", class: "revenue" },
  { code: "3003", name: "Försäljning inom Sverige, 6% moms", class: "revenue" },
  { code: "3004", name: "Försäljning inom Sverige, momsfri", class: "revenue" },
  { code: "3308", name: "Försäljning tjänster till annat EU-land", class: "revenue" },
  { code: "3400", name: "Försäljning tjänster utanför EU", class: "revenue" },
  { code: "3740", name: "Öres- och kronutjämning", class: "revenue" },
  { code: "3990", name: "Övriga ersättningar och intäkter", class: "revenue" },

  // 4-7xxx — costs
  { code: "4010", name: "Inköp material och varor, 25% moms", class: "cost" },
  { code: "4056", name: "Inköp av tjänster från annat EU-land, 25% moms", class: "cost" },
  { code: "5010", name: "Lokalhyra", class: "cost" },
  { code: "5410", name: "Förbrukningsinventarier", class: "cost" },
  { code: "5420", name: "Programvaror", class: "cost" },
  { code: "5611", name: "Personbilskostnader", class: "cost" },
  { code: "5800", name: "Resekostnader", class: "cost" },
  { code: "5910", name: "Annonsering", class: "cost" },
  { code: "6110", name: "Kontorsmateriel", class: "cost" },
  { code: "6212", name: "Mobiltelefon", class: "cost" },
  { code: "6230", name: "Datakommunikation", class: "cost" },
  { code: "6250", name: "Postbefordran", class: "cost" },
  { code: "6310", name: "Företagsförsäkringar", class: "cost" },
  { code: "6420", name: "Ersättningar till revisor", class: "cost" },
  { code: "6530", name: "Redovisningstjänster", class: "cost" },
  { code: "6540", name: "IT-tjänster", class: "cost" },
  { code: "6570", name: "Bankkostnader", class: "cost" },
  { code: "6991", name: "Övriga externa kostnader, avdragsgilla", class: "cost" },
  { code: "7010", name: "Löner till kollektivanställda", class: "cost" },
  { code: "7210", name: "Löner till tjänstemän", class: "cost" },
  { code: "7510", name: "Lagstadgade sociala avgifter", class: "cost" },
  { code: "7690", name: "Övriga personalkostnader", class: "cost" },

  // 8xxx — financial items / tax
  { code: "8310", name: "Ränteintäkter från omsättningstillgångar", class: "financial" },
  { code: "8410", name: "Räntekostnader för långfristiga skulder", class: "financial" },
  { code: "8910", name: "Skatt på årets resultat", class: "financial" },
];

export function findAccount(code: string): BasAccount | undefined {
  return BAS_ACCOUNTS.find((a) => a.code === code);
}

/** Classify a code by its leading digit even if it's outside the curated subset. */
export function accountClass(code: string): AccountClass {
  switch (code[0]) {
    case "1":
      return "asset";
    case "2":
      return "equity_liability";
    case "3":
      return "revenue";
    case "8":
      return "financial";
    default:
      return "cost";
  }
}
