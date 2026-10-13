import { supabase } from "@/lib/supabase";
import type { ParsedStatement, Rule, StatementRow } from "@/lib/amex";
import type { LineItem, OneOff } from "@/lib/budget";

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
  /** Covered by this one-off: the one-off's amount counts instead */
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
// ""            uncategorized (counted as uncategorized spending)
// "exclude"     don't count
// "oneoff:<id>" already entered as that one-off
// "<item id>"   that line item

export const EXCLUDE = "exclude";
const ONE_OFF = "oneoff:";

export type Destination = { line_item_id: string | null; one_off_id: string | null; excluded: boolean };

export function destinationValue(d: Destination): string {
  if (d.excluded) return EXCLUDE;
  if (d.one_off_id) return ONE_OFF + d.one_off_id;
  return d.line_item_id ?? "";
}

export function parseDestination(value: string): Destination {
  if (value === EXCLUDE) return { line_item_id: null, one_off_id: null, excluded: true };
  if (value.startsWith(ONE_OFF)) return { line_item_id: null, one_off_id: value.slice(ONE_OFF.length), excluded: false };
  return { line_item_id: value || null, one_off_id: null, excluded: false };
}

// ---------- Data access ----------

const TX_COLUMNS =
  "id, import_id, posted_on, month, description, merchant, card_member, source_category, amount, line_item_id, one_off_id, excluded";
const IMPORT_COLUMNS = "id, source, account_label, period_start, period_end, file_name, row_count, total, created_at";

const toTx = (t: Transaction): Transaction => ({ ...t, amount: Number(t.amount) });

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
 * Remember "always file this merchant here" or "never count it". Linking to a one-off is
 * specific to one purchase, so it isn't remembered; neither is "uncategorized".
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

export type ReviewedRow = {
  row: StatementRow;
  destination: Destination;
  /** Turn this charge into a new one-off (grouped with same-merchant charges that month) */
  makeOneOff: boolean;
};

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s&/-])(\w)/g, (_, p, c) => p + c.toUpperCase());

/**
 * Save one statement's new rows: the import record, any new one-offs made from charges
 * (one per merchant per month, filed where the charges were), then the transactions.
 * If anything fails, the import record is deleted, which removes the rest with it.
 */
export async function saveStatement(
  statement: ParsedStatement,
  fileName: string,
  rows: ReviewedRow[],
  items: LineItem[]
): Promise<{ record: ImportRecord; oneOffs: OneOff[] }> {
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
    // New one-offs: group by month + merchant + where they're filed
    const groups = new Map<string, ReviewedRow[]>();
    for (const r of rows) {
      if (!r.makeOneOff || r.destination.excluded || r.destination.one_off_id) continue;
      const key = `${r.row.month}|${r.row.merchant}|${r.destination.line_item_id ?? ""}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    const created: OneOff[] = [];
    const oneOffFor = new Map<ReviewedRow, string>();
    for (const list of groups.values()) {
      const amount = Math.round(list.reduce((s, r) => s + Math.round(r.row.amount * 100), 0)) / 100;
      if (amount <= 0) continue;
      const itemId = list[0].destination.line_item_id;
      const { data, error: ooError } = await supabase
        .from("one_offs")
        .insert({
          name: titleCase(list[0].row.merchant),
          amount,
          month: list[0].row.month,
          line_item_id: itemId,
          category_id: itemId ? items.find((i) => i.id === itemId)?.category_id ?? null : null,
          note: list.length > 1 ? `Amex, ${list.length} charges` : "Amex",
          import_id: imp.id,
        })
        .select("id, name, amount, month, category_id, line_item_id, note")
        .single();
      if (ooError) throw ooError;
      created.push({ ...(data as OneOff), amount: Number(data.amount) });
      for (const r of list) oneOffFor.set(r, data.id as string);
    }

    const payload = rows.map((r) => {
      const oneOffId = oneOffFor.get(r) ?? r.destination.one_off_id;
      return {
        import_id: imp.id,
        source: "amex",
        external_id: r.row.externalId,
        posted_on: r.row.postedOn,
        month: r.row.month,
        description: r.row.description,
        merchant: r.row.merchant,
        card_member: r.row.cardMember,
        source_category: r.row.sourceCategory,
        amount: r.row.amount,
        line_item_id: oneOffId || r.destination.excluded ? null : r.destination.line_item_id,
        one_off_id: oneOffId,
        excluded: r.destination.excluded,
      };
    });
    for (let i = 0; i < payload.length; i += 500) {
      const { error: txError } = await supabase.from("transactions").insert(payload.slice(i, i + 500));
      if (txError) throw txError;
    }
    return { record: { ...(imp as ImportRecord), total: Number(imp.total) }, oneOffs: created };
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

/** Undo an import: its transactions and the one-offs made from them are deleted with it. */
export async function deleteImport(id: string) {
  const { error } = await supabase.from("imports").delete().eq("id", id);
  if (error) throw error;
}

/** "2026-09-24" → "9/24" */
export function formatDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}
