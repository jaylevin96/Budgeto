import { supabase } from "@/lib/supabase";
import { ONE_OFF_COLUMNS, parseAmount, toOneOff, type OneOff } from "@/lib/budget";
import { TX_COLUMNS, toTx, type Transaction } from "@/lib/transactions";

/** One search hit: a card charge or a manual entry (recurring occurrences included) */
export type SearchRow = { kind: "card"; tx: Transaction } | { kind: "manual"; oneOff: OneOff };

export const rowId = (r: SearchRow) => (r.kind === "card" ? r.tx.id : r.oneOff.id);
export const rowMonth = (r: SearchRow) => (r.kind === "card" ? r.tx.month : r.oneOff.month);
export const rowAmount = (r: SearchRow) => (r.kind === "card" ? r.tx.amount : r.oneOff.amount);
/** Sort date: posting day for card charges, first of the month for manual entries */
const rowDate = (r: SearchRow) => (r.kind === "card" ? r.tx.posted_on : r.oneOff.month);

/** Newest first; card charges before manual entries on the same day */
export function sortRows(rows: SearchRow[]): SearchRow[] {
  return [...rows].sort((a, b) => rowDate(b).localeCompare(rowDate(a)) || (a.kind === b.kind ? 0 : a.kind === "card" ? -1 : 1));
}

/** "42.50" or "$1,200" → 42.5 / 1200; anything else → null */
function queryAmount(q: string): number | null {
  const n = parseAmount(q);
  return n != null && !Number.isNaN(n) && n > 0 ? n : null;
}

/** A query worth running: 2+ characters, or an amount */
export const isSearchable = (q: string) => q.trim().length >= 2 || queryAmount(q.trim()) != null;

/** Case-insensitive match on the row's text fields, or an exact amount (credits match by size) */
export function matchesQuery(row: SearchRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const amount = queryAmount(q);
  if (amount != null && Math.abs(rowAmount(row)) === amount) return true;
  const fields =
    row.kind === "card"
      ? [row.tx.merchant, row.tx.description, row.tx.card_member, row.tx.source_category]
      : [row.oneOff.name, row.oneOff.note];
  return fields.some((f) => f?.toLowerCase().includes(q));
}

const LIMIT = 500;

export type SearchResult = {
  rows: SearchRow[];
  /** Manual entries the matched card charges are linked to (for their destination picker) */
  linkedOneOffs: OneOff[];
  /** More matches exist than were returned */
  truncated: boolean;
};

/** PostgREST `or` filter: each column ilike the query (quoted so commas and parentheses are safe), plus the amount */
function orFilter(columns: string[], q: string, amount: number | null, signed: boolean): string {
  const pattern = `"*${q.replace(/["\\*%]/g, " ").trim()}*"`;
  const parts = columns.map((c) => `${c}.ilike.${pattern}`);
  if (amount != null) parts.push(`amount.eq.${amount}`);
  if (amount != null && signed) parts.push(`amount.eq.${-amount}`);
  return parts.join(",");
}

/** Search card charges and manual entries across months (optionally within [fromKey, toKeyExclusive)) */
export async function searchAll(query: string, range: { fromKey?: string; toKeyExclusive?: string } = {}): Promise<SearchResult> {
  const q = query.trim();
  const amount = queryAmount(q);

  let txQuery = supabase
    .from("transactions")
    .select(TX_COLUMNS)
    .or(orFilter(["merchant", "description", "card_member", "source_category"], q, amount, true));
  let ooQuery = supabase.from("one_offs").select(ONE_OFF_COLUMNS).or(orFilter(["name", "note"], q, amount, false));
  if (range.fromKey) {
    txQuery = txQuery.gte("month", range.fromKey);
    ooQuery = ooQuery.gte("month", range.fromKey);
  }
  if (range.toKeyExclusive) {
    txQuery = txQuery.lt("month", range.toKeyExclusive);
    ooQuery = ooQuery.lt("month", range.toKeyExclusive);
  }

  const [tx, oo] = await Promise.all([
    txQuery.order("posted_on", { ascending: false }).order("id").limit(LIMIT + 1),
    ooQuery.order("month", { ascending: false }).order("created_at", { ascending: false }).limit(LIMIT + 1),
  ]);
  if (tx.error) throw tx.error;
  if (oo.error) throw oo.error;

  const charges = (tx.data as Transaction[]).slice(0, LIMIT).map(toTx);
  const entries = (oo.data as OneOff[]).slice(0, LIMIT).map(toOneOff);

  // The charges' linked entries, when the search didn't already return them
  const have = new Set(entries.map((o) => o.id));
  const missing = [...new Set(charges.map((t) => t.one_off_id).filter((id): id is string => !!id && !have.has(id)))];
  let linked: OneOff[] = [];
  if (missing.length) {
    const { data, error } = await supabase.from("one_offs").select(ONE_OFF_COLUMNS).in("id", missing);
    if (error) throw error;
    linked = (data as OneOff[]).map(toOneOff);
  }

  return {
    rows: sortRows([
      ...charges.map((t): SearchRow => ({ kind: "card", tx: t })),
      ...entries.map((o): SearchRow => ({ kind: "manual", oneOff: o })),
    ]),
    linkedOneOffs: [...entries, ...linked],
    truncated: tx.data.length > LIMIT || oo.data.length > LIMIT,
  };
}
