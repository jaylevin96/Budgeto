import { supabase } from "@/lib/supabase";

export type CategoryKind = "income" | "expense" | "savings";
export type Recurrence = "fixed" | "variable" | "none";

export type Category = {
  id: string;
  name: string;
  kind: CategoryKind;
  sort_order: number;
  archived: boolean;
};

export type LineItem = {
  id: string;
  category_id: string;
  name: string;
  recurrence: Recurrence;
  default_amount: number | null;
  sort_order: number;
  archived: boolean;
};

export type MonthlyAmount = {
  id: string;
  line_item_id: string;
  /** First of month, YYYY-MM-01 */
  month: string;
  amount: number;
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

export type BudgetData = {
  categories: Category[];
  items: LineItem[];
  amounts: MonthlyAmount[];
};

export async function fetchStructure(): Promise<{ categories: Category[]; items: LineItem[] }> {
  const [cats, items] = await Promise.all([
    supabase.from("categories").select("id, name, kind, sort_order, archived").order("sort_order").order("name"),
    supabase
      .from("line_items")
      .select("id, category_id, name, recurrence, default_amount, sort_order, archived")
      .order("sort_order")
      .order("name"),
  ]);
  if (cats.error) throw cats.error;
  if (items.error) throw items.error;
  return {
    categories: cats.data as Category[],
    items: (items.data as LineItem[]).map((i) => ({
      ...i,
      default_amount: i.default_amount == null ? null : Number(i.default_amount),
    })),
  };
}

/** Amounts for months in [fromKey, toKeyExclusive) */
export async function fetchAmounts(fromKey: string, toKeyExclusive: string): Promise<MonthlyAmount[]> {
  const out: MonthlyAmount[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("monthly_amounts")
      .select("id, line_item_id, month, amount, note")
      .gte("month", fromKey)
      .lt("month", toKeyExclusive)
      .order("month")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...(data as MonthlyAmount[]).map((a) => ({ ...a, amount: Number(a.amount) })));
    if (data.length < pageSize) break;
  }
  return out;
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
    .select("id, line_item_id, month, amount, note")
    .single();
  if (error) throw error;
  return { ...(data as MonthlyAmount), amount: Number(data.amount) };
}

export async function saveAmountsBulk(rows: { line_item_id: string; month: string; amount: number }[]): Promise<MonthlyAmount[]> {
  if (!rows.length) return [];
  const out: MonthlyAmount[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await supabase
      .from("monthly_amounts")
      .upsert(rows.slice(i, i + 500), { onConflict: "line_item_id,month" })
      .select("id, line_item_id, month, amount, note");
    if (error) throw error;
    out.push(...(data as MonthlyAmount[]).map((a) => ({ ...a, amount: Number(a.amount) })));
  }
  return out;
}

// ---------- Rollups ----------

/** lineItemId → monthKey → amount */
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

export type MonthSummary = {
  month: string;
  income: number;
  spending: number;
  savings: number;
  /** income − spending − savings: what's left over */
  net: number;
  /** Count of entered cells this month */
  entered: number;
};

export function summarizeMonth(
  month: string,
  categories: Category[],
  items: LineItem[],
  idx: AmountIndex
): MonthSummary {
  const kindByCat = new Map(categories.map((c) => [c.id, c.kind]));
  const totals: Record<CategoryKind, number[]> = { income: [], expense: [], savings: [] };
  let entered = 0;
  for (const item of items) {
    const v = idx.get(item.id)?.get(month);
    if (v === undefined) continue;
    entered++;
    const kind = kindByCat.get(item.category_id);
    if (kind) totals[kind].push(v);
  }
  const income = sumMoney(totals.income);
  const spending = sumMoney(totals.expense);
  const savings = sumMoney(totals.savings);
  return { month, income, spending, savings, net: sumMoney([income, -spending, -savings]), entered };
}

export function totalForCategoryMonth(categoryId: string, month: string, items: LineItem[], idx: AmountIndex): number {
  return sumMoney(items.filter((i) => i.category_id === categoryId).map((i) => idx.get(i.id)?.get(month) ?? 0));
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

/** Flag amounts far from the item's recent average. */
export function anomalyHint(item: LineItem, month: string, value: number, idx: AmountIndex): string | null {
  const avg = trailingAverage(item.id, month, idx);
  if (avg === null || avg < 20) return null;
  if (value > avg * 2 || value < avg * 0.5) {
    return `Usually about ${formatMoney(avg)}`;
  }
  return null;
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
