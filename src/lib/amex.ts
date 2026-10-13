// Parse and categorize the American Express "Transaction Details" export
// (americanexpress.com → Statements & Activity → Download → Excel or CSV).
// Pure functions: no Supabase, so they can be checked against a sample file directly.

export type StatementRow = {
  /** Amex Reference, or a synthesized key when the export has no Reference column */
  externalId: string;
  /** YYYY-MM-DD */
  postedOn: string;
  /** First of month, YYYY-MM-01 */
  month: string;
  description: string;
  merchant: string;
  cardMember: string | null;
  sourceCategory: string | null;
  /** Charges positive, credits negative */
  amount: number;
  /** "Amex Split Credit": a friend paying back their share at this merchant */
  splitOf: string | null;
};

export type ParsedStatement = {
  accountLabel: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  rows: StatementRow[];
  /** From the "Transaction Summary" sheet, when present, to check the parse */
  summary: { charges: number; credits: number } | null;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const round2 = (n: number) => Math.round(n * 100) / 100;

/** "Aug 26, 2026" → "2026-08-26" */
function parseLongDate(s: string): string | null {
  const m = s.trim().match(/^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})$/);
  if (!m) return null;
  const mi = MONTHS.indexOf(m[1].toLowerCase());
  return mi < 0 ? null : `${m[3]}-${pad(mi + 1)}-${pad(Number(m[2]))}`;
}

/** "09/24/2026", an Excel serial number, or a Date → "2026-09-24" */
function parseCellDate(v: unknown, ssf: { parse_date_code: (n: number) => { y: number; m: number; d: number } }): string | null {
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m) return null;
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${year}-${pad(Number(m[1]))}-${pad(Number(m[2]))}`;
  }
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = ssf.parse_date_code(v);
    return `${d.y}-${pad(d.m)}-${pad(d.d)}`;
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  return null;
}

function parseNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return round2(v);
  if (typeof v === "string") {
    const s = v.replace(/[$,\s]/g, "");
    const neg = /^\(.*\)$/.test(s);
    const n = Number(s.replace(/[()]/g, ""));
    if (s !== "" && Number.isFinite(n)) return round2(neg ? -n : n);
  }
  return null;
}

const PREFIX = /^(APLPAY|TST\*|SQ ?\*|SP |FSP\*|VCN\*|DD ?\*|PAYPAL ?\*|GOOGLE ?\*|PY ?\*|BT\*|IC\*|CKO\*|TOAST\*)\s*/i;

/** Strip payment-processor prefixes, store numbers and trailing codes: "AplPay TST* CHIPOTLE 0042" → "CHIPOTLE". */
export function cleanMerchant(raw: string): string {
  let s = raw.toUpperCase().replace(/\s+/g, " ").trim();
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(PREFIX, "").trim();
  }
  const tokens = s.split(" ");
  // Drop trailing tokens that are store numbers / codes ("0042", "#11445", "C031103") or bare punctuation
  while (tokens.length > 1 && /\d|^[^A-Z]+$/.test(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(" ") || raw.trim().toUpperCase();
}

/**
 * Amex descriptions are fixed width: 20 chars of merchant, 20 of city, then state.
 * When the second line of "Extended Details" is the untruncated name, prefer it.
 */
export function normalizeMerchant(description: string, extended: string | null): string {
  const base = cleanMerchant(description.length > 20 ? description.slice(0, 20) : description);
  const line2 = extended?.split("\n")[1]?.trim();
  if (line2) {
    const full = cleanMerchant(line2);
    if (full.length > base.length && full.startsWith(base)) return full;
  }
  return base;
}

const SPLIT_CREDIT = /^amex split credit/i;

type SheetLib = {
  read: (data: ArrayBuffer, opts: object) => { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: { sheet_to_json: (sheet: unknown, opts: object) => unknown[] };
  SSF: { parse_date_code: (n: number) => { y: number; m: number; d: number } };
};

/** Parse an Amex Excel or CSV export. Throws with a readable message if it doesn't look like one. */
export async function parseAmexStatement(data: ArrayBuffer, lib?: SheetLib): Promise<ParsedStatement> {
  const XLSX = (lib ?? (await import("xlsx"))) as SheetLib;
  // raw: keep CSV text as-is so "09/24/2026" isn't reinterpreted as a locale date
  const wb = XLSX.read(data, { type: "array", raw: true });
  const toRows = (name: string) =>
    XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, blankrows: true, raw: true }) as unknown[][];
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));

  const detailsName = wb.SheetNames.find((n) => /transaction details/i.test(n)) ?? wb.SheetNames[0];
  const rows = toRows(detailsName);

  // Header row: the one that names Date, Description and Amount
  const headerIdx = rows.findIndex((r) => {
    const cells = r.map((c) => text(c).toLowerCase());
    return cells.includes("date") && cells.includes("description") && cells.includes("amount");
  });
  if (headerIdx < 0) {
    throw new Error("This doesn't look like an Amex export: couldn't find the Date / Description / Amount header row.");
  }
  const header = rows[headerIdx].map((c) => text(c).toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const c = {
    date: col("date"),
    description: col("description"),
    amount: col("amount"),
    cardMember: col("card member"),
    extended: col("extended details"),
    reference: col("reference"),
    category: col("category"),
  };

  // "American Express Gold Card / Aug 26, 2026 to Sep 24, 2026" in the block above the header
  let accountLabel: string | null = null;
  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  for (const r of rows.slice(0, headerIdx)) {
    for (const cell of r) {
      const m = text(cell).match(/^(.*?)\s*\/\s*([A-Za-z]{3,9}\.? \d{1,2}, \d{4}) to ([A-Za-z]{3,9}\.? \d{1,2}, \d{4})$/);
      if (m) {
        accountLabel = m[1] || null;
        periodStart = parseLongDate(m[2]);
        periodEnd = parseLongDate(m[3]);
      }
    }
  }

  const out: StatementRow[] = [];
  const seen = new Map<string, number>();
  for (const r of rows.slice(headerIdx + 1)) {
    const postedOn = parseCellDate(r[c.date], XLSX.SSF);
    const amount = parseNumber(r[c.amount]);
    const rawDescription = text(r[c.description]);
    const description = rawDescription.replace(/\s+/g, " ");
    if (!postedOn || amount === null || !description) continue;
    const extended = c.extended >= 0 ? text(r[c.extended]) || null : null;

    let externalId = c.reference >= 0 ? text(r[c.reference]).replace(/^'/, "") : "";
    if (!externalId) {
      // No Reference column (basic CSV): date|description|amount, numbered for identical repeats
      const base = `${postedOn}|${description}|${amount}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      externalId = `${base}|${n}`;
    }

    const isSplit = SPLIT_CREDIT.test(description);
    // Split credits name the original merchant on line 2 of Extended Details
    const splitOf = isSplit ? cleanMerchant(extended?.split("\n")[1]?.trim() || "") || null : null;

    out.push({
      externalId,
      postedOn,
      month: `${postedOn.slice(0, 7)}-01`,
      description,
      merchant: splitOf ?? normalizeMerchant(rawDescription, extended),
      cardMember: c.cardMember >= 0 ? text(r[c.cardMember]) || null : null,
      sourceCategory: c.category >= 0 ? text(r[c.category]) || null : null,
      amount,
      splitOf,
    });
  }
  if (!out.length) throw new Error("Found the header row but no transactions under it.");

  // Totals from the "Transaction Summary" sheet, if the export has one
  let summary: ParsedStatement["summary"] = null;
  const summaryName = wb.SheetNames.find((n) => /transaction summary/i.test(n));
  if (summaryName) {
    let charges: number | null = null;
    let credits: number | null = null;
    for (const r of toRows(summaryName)) {
      const label = text(r[0]).toLowerCase();
      if (label === "charges" && charges === null) charges = parseNumber(r[1]);
      if (label === "payments & credits" && credits === null) credits = parseNumber(r[1]);
    }
    if (charges !== null && credits !== null) summary = { charges, credits };
  }

  return { accountLabel, periodStart, periodEnd, rows: out, summary };
}

// ---------- Categorizing ----------

export type Rule = {
  match_type: "merchant" | "source_category";
  pattern: string;
  line_item_id: string | null;
  exclude: boolean;
};

export type Assignment = {
  lineItemId: string | null;
  excluded: boolean;
  /** Why: shown on the review screen */
  reason: "payment" | "merchant rule" | "category rule" | "split" | "suggested" | "none";
};

const PAYMENT = /(autopay payment|payment - thank you|online payment|mobile payment)/i;

/** Built-in guesses by Amex category, as [category name, line item name] in the default budget. */
const CATEGORY_DEFAULTS: [RegExp, string, string][] = [
  [/^restaurant-/i, "Daily Living", "Dining out"],
  [/^merchandise & supplies-groceries$/i, "Daily Living", "Groceries"],
  [/^travel-lodging$/i, "Vacations", "Accommodations"],
  [/^travel-airline/i, "Vacations", "Plane fare"],
  [/^travel-vehicle rental$/i, "Vacations", "Rental car"],
  [/^transportation-fuel/i, "Transportation", "Gas/fuel"],
  [/^merchandise & supplies-(clothing|department)/i, "Personal", "Clothing"],
  [/^merchandise & supplies-book/i, "Personal", "Books"],
  [/^entertainment-theatrical/i, "Entertainment", "Movies/plays"],
  [/^communications-cable/i, "Entertainment", "Cable TV"],
];

/** Built-in guesses by merchant, checked before the category defaults. */
const MERCHANT_DEFAULTS: [RegExp, string, string][] = [
  [/^NETFLIX/, "Subscriptions", "Netflix"],
  [/^HULU/, "Subscriptions", "Hulu"],
];

type Named = { id: string; name: string };

/**
 * Decide a line item for each row, in order: payments are excluded; then the user's merchant
 * rules, the user's Amex-category rules, split credits (follow the original charge), then
 * built-in guesses. Anything left is uncategorized.
 */
export function categorize(
  rows: StatementRow[],
  rules: Rule[],
  items: (Named & { category_id: string; archived?: boolean })[],
  categories: Named[]
): Assignment[] {
  const merchantRules = new Map(rules.filter((r) => r.match_type === "merchant").map((r) => [r.pattern, r]));
  const categoryRules = new Map(
    rules.filter((r) => r.match_type === "source_category").map((r) => [r.pattern.toLowerCase(), r])
  );
  const key = (s: string) => s.trim().toLowerCase();
  const catName = new Map(categories.map((c) => [c.id, key(c.name)]));
  const live = items.filter((i) => !i.archived);
  const findItem = (category: string, item: string) =>
    live.find((i) => key(i.name) === key(item) && catName.get(i.category_id) === key(category))?.id ??
    live.find((i) => key(i.name) === key(item))?.id ??
    null;
  const fromRule = (r: Rule, reason: Assignment["reason"]): Assignment => ({
    lineItemId: r.exclude ? null : r.line_item_id,
    excluded: r.exclude,
    reason,
  });

  function guess(row: StatementRow): Assignment {
    for (const [re, c, i] of MERCHANT_DEFAULTS) {
      if (re.test(row.merchant)) {
        const id = findItem(c, i);
        if (id) return { lineItemId: id, excluded: false, reason: "suggested" };
      }
    }
    if (row.sourceCategory) {
      for (const [re, c, i] of CATEGORY_DEFAULTS) {
        if (re.test(row.sourceCategory)) {
          const id = findItem(c, i);
          if (id) return { lineItemId: id, excluded: false, reason: "suggested" };
        }
      }
    }
    return { lineItemId: null, excluded: false, reason: "none" };
  }

  function assign(row: StatementRow): Assignment {
    if (PAYMENT.test(row.description)) return { lineItemId: null, excluded: true, reason: "payment" };
    const mr = merchantRules.get(row.merchant);
    if (mr) return fromRule(mr, "merchant rule");
    if (!row.splitOf && row.sourceCategory) {
      const cr = categoryRules.get(row.sourceCategory.toLowerCase());
      if (cr) return fromRule(cr, "category rule");
    }
    return row.splitOf ? { lineItemId: null, excluded: false, reason: "none" } : guess(row);
  }

  const result = rows.map(assign);

  // Split credits: use whatever the matching charge in this statement got
  rows.forEach((row, i) => {
    if (!row.splitOf || result[i].reason !== "none") return;
    const s = row.splitOf;
    const match = rows
      .map((r, j) => ({ r, a: result[j] }))
      .filter(({ r, a }) => !r.splitOf && r.amount > 0 && a.lineItemId && (r.merchant.startsWith(s) || s.startsWith(r.merchant)))
      .sort((x, y) => Math.abs(Date.parse(x.r.postedOn) - Date.parse(row.postedOn)) - Math.abs(Date.parse(y.r.postedOn) - Date.parse(row.postedOn)))[0];
    if (match) result[i] = { lineItemId: match.a.lineItemId, excluded: false, reason: "split" };
  });

  return result;
}
