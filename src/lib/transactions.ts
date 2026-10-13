import { supabase } from "@/lib/supabase";
import type { ParsedStatement, Rule, StatementRow } from "@/lib/amex";

export type Transaction = {
  id: string;
  import_id: string;
  posted_on: string;
  /** First of month, YYYY-MM-01 */
  month: string;
  description: string;
  merchant: string;
  card_member: string | null;
  source_category: string | null;
  /** Charges positive, credits negative */
  amount: number;
  line_item_id: string | null;
  /** Filed to a category without a specific line item (ignored when line_item_id is set) */
  category_id: string | null;
  /** Covered by this entry (one-off): the entry's amount counts instead */
  one_off_id: string | null;
  excluded: boolean;
};

export type ImportRecord = {
  id: string;
  source: string;
  account_label: string | null;
  period_start: string | null;
  period_end: string | null;
  file_name: string | null;
  row_count: number;
  total: number;
  created_at: string;
};

/** Whether a transaction adds to totals on its own (not excluded, not covered by a one-off) */
export const countsOnItsOwn = (t: Pick<Transaction, "excluded" | "one_off_id">) => !t.excluded && !t.one_off_id;

// ---------- Where a charge goes, as one <select> value ----------
// ""              uncategorized (counted as uncategorized spending)
// "exclude"       don't count
// "oneoff:<id>"   already added as that entry
// "category:<id>" that category, no specific line item
// "<item id>"     that line item

export const EXCLUDE = "exclude";
const ONE_OFF = "oneoff:";
const CATEGORY = "category:";

export type Destination = {
  line_item_id: string | null;
  category_id: string | null;
  one_off_id: string | null;
  excluded: boolean;
};

const nowhere: Destination = { line_item_id: null, category_id: null, one_off_id: null, excluded: false };

export function destinationValue(d: Destination): string {
  if (d.excluded) return EXCLUDE;
  if (d.one_off_id) return ONE_OFF + d.one_off_id;
  if (d.line_item_id) return d.line_item_id;
  if (d.category_id) return CATEGORY + d.category_id;
  return "";
}

export function parseDestination(value: string): Destination {
  if (value === EXCLUDE) return { ...nowhere, excluded: true };
  if (value.startsWith(ONE_OFF)) return { ...nowhere, one_off_id: value.slice(ONE_OFF.length) };
  if (value.startsWith(CATEGORY)) return { ...nowhere, category_id: value.slice(CATEGORY.length) };
  return { ...nowhere, line_item_id: value || null };
}

export const categoryValue = (categoryId: string) => CATEGORY + categoryId;

// ---------- Data access ----------

export const TX_COLUMNS =
  "id, import_id, posted_on, month, description, merchant, card_member, source_category, amount, line_item_id, category_id, one_off_id, excluded";
const IMPORT_COLUMNS = "id, source, account_label, period_start, period_end, file_name, row_count, total, created_at";

export const toTx = (t: Transaction): Transaction => ({ ...t, amount: Number(t.amount) });

/** Card transactions for months in [fromKey, toKeyExclusive) */
export async function fetchTransactions(fromKey: string, toKeyExclusive: string): Promise<Transaction[]> {
  const out: Transaction[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("transactions")
      .select(TX_COLUMNS)
      .gte("month", fromKey)
      .lt("month", toKeyExclusive)
      .order("posted_on")
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...(data as Transaction[]).map(toTx));
    if (data.length < pageSize) break;
  }
  return out;
}

export async function updateTransactions(ids: string[], d: Destination): Promise<Transaction[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase.from("transactions").update(d).in("id", ids).select(TX_COLUMNS);
  if (error) throw error;
  return (data as Transaction[]).map(toTx);
}

export async function fetchRules(): Promise<Rule[]> {
  const { data, error } = await supabase.from("merchant_rules").select("match_type, pattern, line_item_id, exclude");
  if (error) throw error;
  return data as Rule[];
}

/**
 * Remember "always file this merchant here" or "never count it". Linking to an entry is
 * specific to one purchase, so it isn't remembered; neither are "uncategorized" and a category
 * without a line item (rules point at line items).
 */
export async function saveMerchantRules(rules: { merchant: string; destination: Destination }[]) {
  const latest = new Map<string, Destination>();
  for (const r of rules) {
    if (r.destination.excluded || (r.destination.line_item_id && !r.destination.one_off_id)) latest.set(r.merchant, r.destination);
  }
  const rows = [...latest].map(([pattern, d]) => ({
    match_type: "merchant",
    pattern,
    line_item_id: d.excluded ? null : d.line_item_id,
    exclude: d.excluded,
  }));
  if (!rows.length) return;
  const { error } = await supabase.from("merchant_rules").upsert(rows, { onConflict: "user_id,match_type,pattern" });
  if (error) throw error;
}

/** Which of these Amex references are already imported */
export async function fetchExistingRefs(refs: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < refs.length; i += 200) {
    const { data, error } = await supabase
      .from("transactions")
      .select("external_id")
      .eq("source", "amex")
      .in("external_id", refs.slice(i, i + 200));
    if (error) throw error;
    for (const r of data) found.add(r.external_id as string);
  }
  return found;
}

export type ReviewedRow = { row: StatementRow; destination: Destination };

/**
 * Save one statement's new rows: the import record, then its transactions.
 * If the transactions fail to insert, the import record is deleted again.
 */
export async function saveStatement(
  statement: ParsedStatement,
  fileName: string,
  rows: ReviewedRow[]
): Promise<ImportRecord> {
  const counted = rows.filter((r) => !r.destination.excluded);
  const total = Math.round(counted.reduce((s, r) => s + Math.round(r.row.amount * 100), 0)) / 100;
  const { data: imp, error } = await supabase
    .from("imports")
    .insert({
      source: "amex",
      account_label: statement.accountLabel,
      period_start: statement.periodStart,
      period_end: statement.periodEnd,
      file_name: fileName,
      row_count: rows.length,
      total,
    })
    .select(IMPORT_COLUMNS)
    .single();
  if (error) throw error;

  try {
    const payload = rows.map(({ row, destination: d }) => ({
      import_id: imp.id,
      source: "amex",
      external_id: row.externalId,
      posted_on: row.postedOn,
      month: row.month,
      description: row.description,
      merchant: row.merchant,
      card_member: row.cardMember,
      source_category: row.sourceCategory,
      amount: row.amount,
      line_item_id: d.one_off_id || d.excluded ? null : d.line_item_id,
      category_id: d.one_off_id || d.excluded ? null : d.category_id,
      one_off_id: d.one_off_id,
      excluded: d.excluded,
    }));
    for (let i = 0; i < payload.length; i += 500) {
      const { error: txError } = await supabase.from("transactions").insert(payload.slice(i, i + 500));
      if (txError) throw txError;
    }
    return { ...(imp as ImportRecord), total: Number(imp.total) };
  } catch (err) {
    await supabase.from("imports").delete().eq("id", imp.id);
    throw err;
  }
}

export async function fetchImports(): Promise<ImportRecord[]> {
  const { data, error } = await supabase
    .from("imports")
    .select(IMPORT_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data as ImportRecord[]).map((r) => ({ ...r, total: Number(r.total) }));
}

/** Undo an import: its transactions are deleted with it. */
export async function deleteImport(id: string) {
  const { error } = await supabase.from("imports").delete().eq("id", id);
  if (error) throw error;
}

/** "2026-09-24" → "9/24" */
export function formatDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}
