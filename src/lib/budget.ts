import { supabase } from "@/lib/supabase";

export type CategoryKind = "income" | "expense" | "savings";
export type Recurrence = "fixed" | "variable" | "none";

export type Category = {
  id: string;
  name: string;
  kind: CategoryKind;
  sort_order: number;
  archived: boolean;
  monthly_budget: number | null;
};

export type LineItem = {
  id: string;
  category_id: string;
  name: string;
  recurrence: Recurrence;
  default_amount: number | null;
  sort_order: number;
  archived: boolean;
  monthly_budget: number | null;
};

export type MonthlyAmount = {
  id: string;
  line_item_id: string;
  /** First of month, YYYY-MM-01 */
  month: string;
  amount: number;
  note: string | null;
};

/** A bigger one-time purchase, optionally tied to a category and/or line item. */
export type OneOff = {
  id: string;
  name: string;
  amount: number;
  /** First of month, YYYY-MM-01 */
  month: string;
  category_id: string | null;
  line_item_id: string | null;
  note: string | null;
};

export const KIND_LABEL: Record<CategoryKind, string> = {
  income: "Income",
  expense: "Spending",
  savings: "Savings",
};

export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  fixed: "Fixed monthly",
  variable: "Monthly, amount varies",
  none: "Occasional",
};

export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ---------- Month helpers (string-based to avoid timezone drift) ----------

/** "2026-10" → "2026-10-01" */
export function monthKey(year: number, monthIndex0: number): string {
  return `${year}-${String(monthIndex0 + 1).padStart(2, "0")}-01`;
}

export function parseMonthKey(key: string): { year: number; month: number } {
  return { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) - 1 };
}

export function addMonths(key: string, delta: number): string {
  const { year, month } = parseMonthKey(key);
  const total = year * 12 + month + delta;
  return monthKey(Math.floor(total / 12), ((total % 12) + 12) % 12);
}

export function currentMonthKey(): string {
  const d = new Date();
  return monthKey(d.getFullYear(), d.getMonth());
}

/** "2026-10-01" → "2026-10" for URLs */
export function monthSlug(key: string): string {
  return key.slice(0, 7);
}

/** "2026-10" → "2026-10-01", or null if malformed */
export function monthKeyFromSlug(slug: string | undefined): string | null {
  if (!slug || !/^\d{4}-(0[1-9]|1[0-2])$/.test(slug)) return null;
  return `${slug}-01`;
}

export function formatMonth(key: string, style: "short" | "long" = "long"): string {
  const { year, month } = parseMonthKey(key);
  return `${(style === "long" ? MONTH_LONG : MONTH_SHORT)[month]} ${year}`;
}

// ---------- Money ----------

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

export function formatMoney(n: number, cents = false): string {
  return (cents ? usdCents : usd).format(n);
}

/** Compact axis label: $6.3k */
export function formatMoneyCompact(n: number): string {
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1)}k`;
  return `$${Math.round(n)}`;
}

/** Parse user input like "$1,234.5" → 1234.5. Returns null for blank, NaN for invalid. */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return NaN;
  return Math.round(Number(cleaned) * 100) / 100;
}

/** Sum money values without float drift */
export function sumMoney(values: number[]): number {
  return Math.round(values.reduce((s, v) => s + Math.round(v * 100), 0)) / 100;
}

// ---------- Data access ----------

const num = (v: unknown) => (v == null ? null : Number(v));

export async function fetchStructure(): Promise<{ categories: Category[]; items: LineItem[] }> {
  const [cats, items] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name, kind, sort_order, archived, monthly_budget")
      .order("sort_order")
      .order("name"),
    supabase
      .from("line_items")
      .select("id, category_id, name, recurrence, default_amount, sort_order, archived, monthly_budget")
      .order("sort_order")
      .order("name"),
  ]);
  if (cats.error) throw cats.error;
  if (items.error) throw items.error;
  return {
    categories: (cats.data as Category[]).map((c) => ({ ...c, monthly_budget: num(c.monthly_budget) })),
    items: (items.data as LineItem[]).map((i) => ({
      ...i,
      default_amount: num(i.default_amount),
      monthly_budget: num(i.monthly_budget),
    })),
  };
}

const AMOUNT_COLUMNS = "id, line_item_id, month, amount, note";
const ONE_OFF_COLUMNS = "id, name, amount, month, category_id, line_item_id, note";

const toAmount = (a: MonthlyAmount): MonthlyAmount => ({ ...a, amount: Number(a.amount) });
const toOneOff = (o: OneOff): OneOff => ({ ...o, amount: Number(o.amount) });

/** Amounts for months in [fromKey, toKeyExclusive) */
export async function fetchAmounts(fromKey: string, toKeyExclusive: string): Promise<MonthlyAmount[]> {
  const out: MonthlyAmount[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("monthly_amounts")
      .select(AMOUNT_COLUMNS)
      .gte("month", fromKey)
      .lt("month", toKeyExclusive)
      .order("month")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...(data as MonthlyAmount[]).map(toAmount));
    if (data.length < pageSize) break;
  }
  return out;
}

/** One-offs for months in [fromKey, toKeyExclusive) */
export async function fetchOneOffs(fromKey: string, toKeyExclusive: string): Promise<OneOff[]> {
  const { data, error } = await supabase
    .from("one_offs")
    .select(ONE_OFF_COLUMNS)
    .gte("month", fromKey)
    .lt("month", toKeyExclusive)
    .order("month")
    .order("created_at");
  if (error) throw error;
  return (data as OneOff[]).map(toOneOff);
}

/** Insert or update a single cell. amount null deletes it (back to "not entered"). */
export async function saveAmount(lineItemId: string, month: string, amount: number | null): Promise<MonthlyAmount | null> {
  if (amount === null) {
    const { error } = await supabase.from("monthly_amounts").delete().eq("line_item_id", lineItemId).eq("month", month);
    if (error) throw error;
    return null;
  }
  const { data, error } = await supabase
    .from("monthly_amounts")
    .upsert({ line_item_id: lineItemId, month, amount }, { onConflict: "line_item_id,month" })
    .select(AMOUNT_COLUMNS)
    .single();
  if (error) throw error;
  return toAmount(data as MonthlyAmount);
}

/** Set or clear the note on an entered cell. */
export async function saveNote(lineItemId: string, month: string, note: string | null): Promise<MonthlyAmount> {
  const { data, error } = await supabase
    .from("monthly_amounts")
    .update({ note: note?.trim() || null })
    .eq("line_item_id", lineItemId)
    .eq("month", month)
    .select(AMOUNT_COLUMNS)
    .single();
  if (error) throw error;
  return toAmount(data as MonthlyAmount);
}

export async function saveAmountsBulk(rows: { line_item_id: string; month: string; amount: number }[]): Promise<MonthlyAmount[]> {
  if (!rows.length) return [];
  const out: MonthlyAmount[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await supabase
      .from("monthly_amounts")
      .upsert(rows.slice(i, i + 500), { onConflict: "line_item_id,month" })
      .select(AMOUNT_COLUMNS);
    if (error) throw error;
    out.push(...(data as MonthlyAmount[]).map(toAmount));
  }
  return out;
}

export type OneOffInput = Omit<OneOff, "id">;

export async function saveOneOff(id: string | null, input: OneOffInput): Promise<OneOff> {
  const row = { ...input, note: input.note?.trim() || null };
  const query = id
    ? supabase.from("one_offs").update(row).eq("id", id)
    : supabase.from("one_offs").insert(row);
  const { data, error } = await query.select(ONE_OFF_COLUMNS).single();
  if (error) throw error;
  return toOneOff(data as OneOff);
}

export async function deleteOneOff(id: string): Promise<void> {
  const { error } = await supabase.from("one_offs").delete().eq("id", id);
  if (error) throw error;
}

// ---------- Rollups ----------

/** lineItemId → monthKey → amount (typed cell values only) */
export type AmountIndex = Map<string, Map<string, number>>;

export function indexAmounts(amounts: MonthlyAmount[]): AmountIndex {
  const idx: AmountIndex = new Map();
  for (const a of amounts) {
    let m = idx.get(a.line_item_id);
    if (!m) idx.set(a.line_item_id, (m = new Map()));
    m.set(a.month, a.amount);
  }
  return idx;
}

type MonthBuckets<T> = Map<string, Map<string, T[]>>;

function bucket<T>(map: MonthBuckets<T>, key: string, month: string, value: T) {
  let m = map.get(key);
  if (!m) map.set(key, (m = new Map()));
  const list = m.get(month);
  if (list) list.push(value);
  else m.set(month, [value]);
}

/**
 * Everything needed to total a month: typed cells plus one-offs.
 * One-offs tied to a line item add to that item; tied only to a category they form
 * that category's "One-offs" row; untied ones are "Uncategorized" spending.
 */
export type Ledger = {
  categories: Category[];
  items: LineItem[];
  /** Typed cell values (base amounts) */
  idx: AmountIndex;
  /** lineItemId → month → note */
  notes: Map<string, Map<string, string>>;
  oneOffs: OneOff[];
  oneOffsByItem: MonthBuckets<OneOff>;
  /** Category-only one-offs (no line item) */
  oneOffsByCategory: MonthBuckets<OneOff>;
  /** month → untied one-offs */
  uncategorized: Map<string, OneOff[]>;
  kindByCategory: Map<string, CategoryKind>;
};

export function buildLedger(
  categories: Category[],
  items: LineItem[],
  amounts: MonthlyAmount[],
  oneOffs: OneOff[]
): Ledger {
  const itemIds = new Set(items.map((i) => i.id));
  const catIds = new Set(categories.map((c) => c.id));
  const notes = new Map<string, Map<string, string>>();
  for (const a of amounts) {
    if (!a.note) continue;
    let m = notes.get(a.line_item_id);
    if (!m) notes.set(a.line_item_id, (m = new Map()));
    m.set(a.month, a.note);
  }
  const oneOffsByItem: MonthBuckets<OneOff> = new Map();
  const oneOffsByCategory: MonthBuckets<OneOff> = new Map();
  const uncategorized = new Map<string, OneOff[]>();
  for (const o of oneOffs) {
    if (o.line_item_id && itemIds.has(o.line_item_id)) bucket(oneOffsByItem, o.line_item_id, o.month, o);
    else if (o.category_id && catIds.has(o.category_id)) bucket(oneOffsByCategory, o.category_id, o.month, o);
    else uncategorized.set(o.month, [...(uncategorized.get(o.month) ?? []), o]);
  }
  return {
    categories,
    items,
    idx: indexAmounts(amounts),
    notes,
    oneOffs,
    oneOffsByItem,
    oneOffsByCategory,
    uncategorized,
    kindByCategory: new Map(categories.map((c) => [c.id, c.kind])),
  };
}

const sumOneOffs = (list: OneOff[] | undefined) => sumMoney((list ?? []).map((o) => o.amount));

export function itemOneOffs(L: Ledger, itemId: string, month: string): OneOff[] {
  return L.oneOffsByItem.get(itemId)?.get(month) ?? [];
}

export function categoryOneOffs(L: Ledger, categoryId: string, month: string): OneOff[] {
  return L.oneOffsByCategory.get(categoryId)?.get(month) ?? [];
}

/** Typed amount + linked one-offs; undefined when neither exists. */
export function itemMonthTotal(L: Ledger, itemId: string, month: string): number | undefined {
  const base = L.idx.get(itemId)?.get(month);
  const linked = L.oneOffsByItem.get(itemId)?.get(month);
  if (base === undefined && !linked?.length) return undefined;
  return sumMoney([base ?? 0, sumOneOffs(linked)]);
}

export function totalForCategoryMonth(L: Ledger, categoryId: string, month: string): number {
  return sumMoney([
    ...L.items.filter((i) => i.category_id === categoryId).map((i) => itemMonthTotal(L, i.id, month) ?? 0),
    sumOneOffs(categoryOneOffs(L, categoryId, month)),
  ]);
}

/** Whether a category has anything (typed or one-off) in a month */
export function categoryHasData(L: Ledger, categoryId: string, month: string): boolean {
  return (
    L.items.some((i) => i.category_id === categoryId && itemMonthTotal(L, i.id, month) !== undefined) ||
    categoryOneOffs(L, categoryId, month).length > 0
  );
}

export function uncategorizedTotal(L: Ledger, month: string): number {
  return sumOneOffs(L.uncategorized.get(month));
}

export type MonthSummary = {
  month: string;
  income: number;
  spending: number;
  savings: number;
  /** income − spending − savings: what's left over */
  net: number;
  /** Count of typed cells this month (for "x of y entered") */
  entered: number;
  /** Total of all one-offs this month */
  oneOffs: number;
  /** Anything at all recorded this month */
  hasData: boolean;
};

export function summarizeMonth(L: Ledger, month: string): MonthSummary {
  const totals: Record<CategoryKind, number[]> = { income: [], expense: [], savings: [] };
  let entered = 0;
  for (const item of L.items) {
    if (L.idx.get(item.id)?.has(month)) entered++;
    const v = itemMonthTotal(L, item.id, month);
    const kind = L.kindByCategory.get(item.category_id);
    if (v !== undefined && kind) totals[kind].push(v);
  }
  for (const [catId, byMonth] of L.oneOffsByCategory) {
    const kind = L.kindByCategory.get(catId);
    if (kind) totals[kind].push(sumOneOffs(byMonth.get(month)));
  }
  totals.expense.push(uncategorizedTotal(L, month));
  const monthOneOffs = L.oneOffs.filter((o) => o.month === month);
  const income = sumMoney(totals.income);
  const spending = sumMoney(totals.expense);
  const savings = sumMoney(totals.savings);
  return {
    month,
    income,
    spending,
    savings,
    net: sumMoney([income, -spending, -savings]),
    entered,
    oneOffs: sumOneOffs(monthOneOffs),
    hasData: entered > 0 || monthOneOffs.length > 0,
  };
}

/** Average of the most recent `n` entered months before `month` (for anomaly hints). */
export function trailingAverage(itemId: string, month: string, idx: AmountIndex, n = 3, lookback = 12): number | null {
  const m = idx.get(itemId);
  if (!m) return null;
  const vals: number[] = [];
  for (let k = 1; k <= lookback && vals.length < n; k++) {
    const v = m.get(addMonths(month, -k));
    if (v !== undefined && v > 0) vals.push(v);
  }
  if (!vals.length) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

/** Most recent entered amount before `month` */
export function lastAmount(itemId: string, month: string, idx: AmountIndex, lookback = 12): number | null {
  const m = idx.get(itemId);
  if (!m) return null;
  for (let k = 1; k <= lookback; k++) {
    const v = m.get(addMonths(month, -k));
    if (v !== undefined) return v;
  }
  return null;
}

/** What the Month page pre-fills for an item, or null for no suggestion. */
export function suggestedAmount(item: LineItem, month: string, idx: AmountIndex): number | null {
  if (item.recurrence === "fixed") return item.default_amount ?? lastAmount(item.id, month, idx, 3);
  // Only suggest from recent history; a value from many months back is probably stale
  if (item.recurrence === "variable") return lastAmount(item.id, month, idx, 3) ?? item.default_amount;
  return null;
}

/** Flag typed amounts far from the item's recent average (one-offs are excluded on purpose). */
export function anomalyHint(item: LineItem, month: string, value: number, idx: AmountIndex): string | null {
  const avg = trailingAverage(item.id, month, idx);
  if (avg === null || avg < 20) return null;
  if (value > avg * 2 || value < avg * 0.5) {
    return `Usually about ${formatMoney(avg)}`;
  }
  return null;
}

/** Budget status for display: tone escalates at 90% and over 100%. */
export function budgetStatus(spent: number, budget: number): { pct: number; tone: "ok" | "near" | "over"; label: string } {
  const pct = budget > 0 ? spent / budget : spent > 0 ? Infinity : 0;
  const tone = pct > 1 ? "over" : pct >= 0.9 ? "near" : "ok";
  const diff = sumMoney([budget, -spent]);
  const label = diff >= 0 ? `${formatMoney(diff)} left` : `${formatMoney(-diff)} over`;
  return { pct, tone, label };
}

/** "Vacations › Plane fare", "Personal", or "Uncategorized" */
export function oneOffTarget(o: OneOff, categories: Category[], items: LineItem[]): string {
  const item = o.line_item_id ? items.find((i) => i.id === o.line_item_id) : undefined;
  const cat = categories.find((c) => c.id === (item?.category_id ?? o.category_id));
  if (item && cat) return `${cat.name} › ${item.name}`;
  if (cat) return cat.name;
  return "Uncategorized";
}

// ---------- Default structure (from the 2026 spreadsheet) ----------

export const DEFAULT_STRUCTURE: { name: string; kind: CategoryKind; items: string[] }[] = [
  { name: "Income", kind: "income", items: ["Jay Wage", "Jillian Wage"] },
  { name: "Home", kind: "expense", items: ["Rent", "Insurance", "Comed", "Gas"] },
  { name: "Daily Living", kind: "expense", items: ["Groceries", "Child care", "Dry cleaning", "Dining out", "Housecleaning service"] },
  { name: "Transportation", kind: "expense", items: ["Gas/fuel", "Car Insurance"] },
  { name: "Entertainment", kind: "expense", items: ["Cable TV", "Movies/plays", "Concerts/clubs"] },
  { name: "Health", kind: "expense", items: ["FFC", "Health Insurance"] },
  { name: "Vacations", kind: "expense", items: ["Plane fare", "Accommodations", "Food", "Rental car"] },
  { name: "Subscriptions", kind: "expense", items: ["Netflix", "Hulu"] },
  { name: "Personal", kind: "expense", items: ["Clothing", "Gifts", "Salon/barber", "Books", "Music"] },
  { name: "Financial Obligations", kind: "savings", items: ["Jay 401k", "Jay Health Savings"] },
  { name: "Misc Payments", kind: "expense", items: [] },
];
