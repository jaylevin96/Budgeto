import { supabase } from "@/lib/supabase";
import { countsOnItsOwn, type Transaction } from "@/lib/transactions";

export type CategoryKind = "income" | "expense" | "savings";
export type Recurrence = "fixed" | "variable" | "none";

export type Category = {
  id: string;
  name: string;
  kind: CategoryKind;
  sort_order: number;
  archived: boolean;
  /** Budget changes, oldest first; see budgetFor */
  budgets: CategoryBudget[];
};

/** "From start_month on, this category's monthly budget is amount" (null = no budget) */
export type CategoryBudget = {
  id: string;
  category_id: string;
  amount: number | null;
  /** First of month, YYYY-MM-01 */
  start_month: string;
};

/** Start month of a budget that carried over from before budgets had dates */
export const BUDGET_FROM_START = "2000-01-01";

export type LineItem = {
  id: string;
  category_id: string;
  name: string;
  recurrence: Recurrence;
  default_amount: number | null;
  sort_order: number;
  archived: boolean;
};

/**
 * A manual entry: a named amount added by hand to a category for one month ("Rent $2,000",
 * "Hotel $500"), optionally on one of its line items. Stored in `one_offs`. Rows from before
 * the category was required may have neither (shown as "Needs a category").
 */
export type OneOff = {
  id: string;
  name: string;
  amount: number;
  /** First of month, YYYY-MM-01 */
  month: string;
  category_id: string | null;
  line_item_id: string | null;
  note: string | null;
  /** Set when this is one month of a recurring entry (see recurring.ts) */
  recurring_id: string | null;
};

export const KIND_LABEL: Record<CategoryKind, string> = {
  income: "Income",
  expense: "Spending",
  savings: "Savings",
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

const CATEGORY_COLUMNS = "id, name, kind, sort_order, archived";
const ITEM_COLUMNS = "id, category_id, name, recurrence, default_amount, sort_order, archived";
const BUDGET_COLUMNS = "id, category_id, amount, start_month";

const toBudget = (b: CategoryBudget): CategoryBudget => ({ ...b, amount: num(b.amount) });

export async function fetchStructure(): Promise<{ categories: Category[]; items: LineItem[] }> {
  const [cats, items, budgets] = await Promise.all([
    supabase.from("categories").select(CATEGORY_COLUMNS).order("sort_order").order("name"),
    supabase.from("line_items").select(ITEM_COLUMNS).order("sort_order").order("name"),
    supabase.from("category_budgets").select(BUDGET_COLUMNS).order("start_month"),
  ]);
  if (cats.error) throw cats.error;
  if (items.error) throw items.error;
  if (budgets.error) throw budgets.error;
  const byCategory = new Map<string, CategoryBudget[]>();
  for (const b of budgets.data as CategoryBudget[]) byCategory.set(b.category_id, [...(byCategory.get(b.category_id) ?? []), toBudget(b)]);
  return {
    categories: (cats.data as Omit<Category, "budgets">[]).map((c) => ({ ...c, budgets: byCategory.get(c.id) ?? [] })),
    items: (items.data as LineItem[]).map((i) => ({ ...i, default_amount: num(i.default_amount) })),
  };
}

/** The category's budget change in effect for `month` (the latest starting on or before it) */
export function budgetChangeFor(category: Category, month: string): CategoryBudget | undefined {
  let found: CategoryBudget | undefined;
  for (const b of category.budgets) if (b.start_month <= month) found = b;
  return found;
}

/** The category's monthly budget for `month`, or null when it has none (income never has one) */
export function budgetFor(category: Category, month: string): number | null {
  if (category.kind === "income") return null;
  return budgetChangeFor(category, month)?.amount ?? null;
}

/** "from Oct 2026", or "from the start" for a budget that carried over */
export function budgetStartLabel(startMonth: string): string {
  return startMonth === BUDGET_FROM_START ? "from the start" : `from ${formatMonth(startMonth, "short")}`;
}

/** Set a category's budget from `startMonth` on (replacing a change that starts that same month). */
export async function saveBudgetChange(categoryId: string, startMonth: string, amount: number | null): Promise<CategoryBudget> {
  const { data, error } = await supabase
    .from("category_budgets")
    .upsert({ category_id: categoryId, start_month: startMonth, amount }, { onConflict: "category_id,start_month" })
    .select(BUDGET_COLUMNS)
    .single();
  if (error) throw error;
  return toBudget(data as CategoryBudget);
}

export async function deleteBudgetChange(id: string): Promise<void> {
  const { error } = await supabase.from("category_budgets").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Save a new order for categories or line items: numbers `ordered` 10, 20, … and writes the rows
 * whose number changed. Returns the rows with their new sort_order.
 */
export async function saveOrder<T extends { id: string; sort_order: number }>(
  table: "categories" | "line_items",
  ordered: T[]
): Promise<T[]> {
  const renumbered = ordered.map((r, k) => ({ ...r, sort_order: (k + 1) * 10 }));
  const changed = renumbered.filter((r, k) => r.sort_order !== ordered[k].sort_order);
  const results = await Promise.all(changed.map((r) => supabase.from(table).update({ sort_order: r.sort_order }).eq("id", r.id)));
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
  return renumbered;
}

export type CreatedStructure = { category: Category | null; item: LineItem };

/**
 * Create a spending line item, in an existing category or a new one (placed last).
 * Used when filing a card charge somewhere that doesn't exist yet.
 */
export async function createLineItem(
  name: string,
  target: { categoryId: string } | { newCategoryName: string },
  existing: { categories: Category[]; items: LineItem[] }
): Promise<CreatedStructure> {
  const nextOrder = (list: { sort_order: number }[]) => Math.max(0, ...list.map((r) => r.sort_order)) + 10;
  let category: Category | null = null;
  let categoryId: string;
  if ("categoryId" in target) {
    categoryId = target.categoryId;
  } else {
    const { data, error } = await supabase
      .from("categories")
      .insert({ name: target.newCategoryName.trim(), kind: "expense", sort_order: nextOrder(existing.categories) })
      .select(CATEGORY_COLUMNS)
      .single();
    if (error) throw error.code === "23505" ? new Error("A category with that name already exists") : error;
    category = { ...(data as Omit<Category, "budgets">), budgets: [] };
    categoryId = category.id;
  }
  const { data, error } = await supabase
    .from("line_items")
    .insert({
      name: name.trim(),
      category_id: categoryId,
      sort_order: nextOrder(existing.items.filter((i) => i.category_id === categoryId)),
    })
    .select(ITEM_COLUMNS)
    .single();
  if (error) {
    // Don't leave an empty new category behind
    if (category) await supabase.from("categories").delete().eq("id", category.id);
    throw error.code === "23505" ? new Error("That category already has a line item with this name") : error;
  }
  const item = data as LineItem;
  return { category, item: { ...item, default_amount: num(item.default_amount) } };
}

const ONE_OFF_COLUMNS = "id, name, amount, month, category_id, line_item_id, note, recurring_id";

const toOneOff = (o: OneOff): OneOff => ({ ...o, amount: Number(o.amount) });

/** Manual entries for months in [fromKey, toKeyExclusive) */
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

/** Insert several manual entries at once (e.g. copying repeating ones into a new month). */
export async function insertOneOffs(rows: OneOffInput[]): Promise<OneOff[]> {
  if (!rows.length) return [];
  const out: OneOff[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await supabase.from("one_offs").insert(rows.slice(i, i + 500)).select(ONE_OFF_COLUMNS);
    if (error) throw error;
    out.push(...(data as OneOff[]).map(toOneOff));
  }
  return out;
}

export async function deleteOneOff(id: string): Promise<void> {
  const { error } = await supabase.from("one_offs").delete().eq("id", id);
  if (error) throw error;
}

// ---------- Rollups ----------

type MonthBuckets<T> = Map<string, Map<string, T[]>>;

function bucket<T>(map: MonthBuckets<T>, key: string, month: string, value: T) {
  let m = map.get(key);
  if (!m) map.set(key, (m = new Map()));
  const list = m.get(month);
  if (list) list.push(value);
  else m.set(month, [value]);
}

/**
 * Everything needed to total a month: manual entries (one-offs) and card charges. Both follow
 * the same rule: on a line item they add to that item; on a category only they form that
 * category's "Other" row; with neither they are "Uncategorized" spending (unfiled card
 * charges, or manual entries from before a category was required). Card charges that are
 * excluded or covered by a manual entry don't count on their own.
 */
export type Ledger = {
  categories: Category[];
  items: LineItem[];
  oneOffs: OneOff[];
  oneOffsByItem: MonthBuckets<OneOff>;
  /** Category-only one-offs (no line item) */
  oneOffsByCategory: MonthBuckets<OneOff>;
  /** month → untied one-offs */
  uncategorized: Map<string, OneOff[]>;
  /** All card transactions loaded (including excluded and covered ones) */
  transactions: Transaction[];
  /** Counted card charges filed under a line item */
  cardByItem: MonthBuckets<Transaction>;
  /** Counted card charges filed to a category without a line item */
  cardByCategory: MonthBuckets<Transaction>;
  /** month → counted card charges not filed anywhere yet */
  cardUncategorized: Map<string, Transaction[]>;
  kindByCategory: Map<string, CategoryKind>;
};

export function buildLedger(
  categories: Category[],
  items: LineItem[],
  oneOffs: OneOff[],
  transactions: Transaction[] = []
): Ledger {
  const itemIds = new Set(items.map((i) => i.id));
  const catIds = new Set(categories.map((c) => c.id));
  const oneOffsByItem: MonthBuckets<OneOff> = new Map();
  const oneOffsByCategory: MonthBuckets<OneOff> = new Map();
  const uncategorized = new Map<string, OneOff[]>();
  for (const o of oneOffs) {
    if (o.line_item_id && itemIds.has(o.line_item_id)) bucket(oneOffsByItem, o.line_item_id, o.month, o);
    else if (o.category_id && catIds.has(o.category_id)) bucket(oneOffsByCategory, o.category_id, o.month, o);
    else uncategorized.set(o.month, [...(uncategorized.get(o.month) ?? []), o]);
  }
  const cardByItem: MonthBuckets<Transaction> = new Map();
  const cardByCategory: MonthBuckets<Transaction> = new Map();
  const cardUncategorized = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (!countsOnItsOwn(t)) continue;
    if (t.line_item_id && itemIds.has(t.line_item_id)) bucket(cardByItem, t.line_item_id, t.month, t);
    else if (t.category_id && catIds.has(t.category_id)) bucket(cardByCategory, t.category_id, t.month, t);
    else cardUncategorized.set(t.month, [...(cardUncategorized.get(t.month) ?? []), t]);
  }
  return {
    categories,
    items,
    oneOffs,
    oneOffsByItem,
    oneOffsByCategory,
    uncategorized,
    transactions,
    cardByItem,
    cardByCategory,
    cardUncategorized,
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

export function itemCard(L: Ledger, itemId: string, month: string): Transaction[] {
  return L.cardByItem.get(itemId)?.get(month) ?? [];
}

/** Card charges filed to the category itself (no line item) */
export function categoryCard(L: Ledger, categoryId: string, month: string): Transaction[] {
  return L.cardByCategory.get(categoryId)?.get(month) ?? [];
}

export function uncategorizedCard(L: Ledger, month: string): Transaction[] {
  return L.cardUncategorized.get(month) ?? [];
}

const sumCard = (list: Transaction[] | undefined) => sumMoney((list ?? []).map((t) => t.amount));

/** Manual entries + card charges on a line item; undefined when there are none. */
export function itemMonthTotal(L: Ledger, itemId: string, month: string): number | undefined {
  const linked = L.oneOffsByItem.get(itemId)?.get(month);
  const card = L.cardByItem.get(itemId)?.get(month);
  if (!linked?.length && !card?.length) return undefined;
  return sumMoney([sumOneOffs(linked), sumCard(card)]);
}

/** Whether a line item has anything this month (a manual entry or a card charge) */
export function itemEntered(L: Ledger, itemId: string, month: string): boolean {
  return itemMonthTotal(L, itemId, month) !== undefined;
}

export function totalForCategoryMonth(L: Ledger, categoryId: string, month: string): number {
  return sumMoney([
    ...L.items.filter((i) => i.category_id === categoryId).map((i) => itemMonthTotal(L, i.id, month) ?? 0),
    sumOneOffs(categoryOneOffs(L, categoryId, month)),
    sumCard(categoryCard(L, categoryId, month)),
  ]);
}

/** The category's "Other" row: manual entries and card charges on the category but no line item */
export function categoryEntriesTotal(L: Ledger, categoryId: string, month: string): number {
  return sumMoney([sumOneOffs(categoryOneOffs(L, categoryId, month)), sumCard(categoryCard(L, categoryId, month))]);
}

export function categoryHasEntries(L: Ledger, categoryId: string, month: string): boolean {
  return categoryOneOffs(L, categoryId, month).length > 0 || categoryCard(L, categoryId, month).length > 0;
}

/** Whether a category has anything (manual entries or card charges) in a month */
export function categoryHasData(L: Ledger, categoryId: string, month: string): boolean {
  return (
    L.items.some((i) => i.category_id === categoryId && itemMonthTotal(L, i.id, month) !== undefined) ||
    categoryHasEntries(L, categoryId, month)
  );
}

/** Manual entries without a category plus unfiled card charges */
export function uncategorizedTotal(L: Ledger, month: string): number {
  return sumMoney([sumOneOffs(L.uncategorized.get(month)), sumCard(L.cardUncategorized.get(month))]);
}

export function hasUncategorized(L: Ledger, month: string): boolean {
  return (L.uncategorized.get(month) ?? []).length > 0 || uncategorizedCard(L, month).length > 0;
}

/** What a set of entries belongs to: a category (its line items plus its "Other" row), one line item, or uncategorized */
export type EntryScope = { kind: "category"; id: string } | { kind: "item"; id: string } | { kind: "uncategorized" };

/** One manual entry or counted card charge, as listed in a breakdown */
export type LedgerEntry = {
  id: string;
  name: string;
  amount: number;
  /** Posting date for card charges; null for manual entries */
  postedOn: string | null;
  /** Line item it rolls into, or null when filed to the category itself (or nowhere) */
  itemName: string | null;
  source: "card" | "manual" | "recurring";
  oneOff: OneOff | null;
};

/** The entries that make up a scope's total for a month, largest first. They sum to the matching *Total function. */
export function ledgerEntries(L: Ledger, scope: EntryScope, month: string): LedgerEntry[] {
  const fromOneOff = (o: OneOff, itemName: string | null): LedgerEntry => ({
    id: o.id,
    name: o.name,
    amount: o.amount,
    postedOn: null,
    itemName,
    source: o.recurring_id ? "recurring" : "manual",
    oneOff: o,
  });
  const fromCard = (t: Transaction, itemName: string | null): LedgerEntry => ({
    id: t.id,
    name: t.merchant || t.description,
    amount: t.amount,
    postedOn: t.posted_on,
    itemName,
    source: "card",
    oneOff: null,
  });
  const forItem = (item: LineItem) => [
    ...itemOneOffs(L, item.id, month).map((o) => fromOneOff(o, item.name)),
    ...itemCard(L, item.id, month).map((t) => fromCard(t, item.name)),
  ];
  let entries: LedgerEntry[];
  if (scope.kind === "item") {
    const item = L.items.find((i) => i.id === scope.id);
    entries = item ? forItem(item) : [];
  } else if (scope.kind === "category") {
    entries = [
      ...L.items.filter((i) => i.category_id === scope.id).flatMap(forItem),
      ...categoryOneOffs(L, scope.id, month).map((o) => fromOneOff(o, null)),
      ...categoryCard(L, scope.id, month).map((t) => fromCard(t, null)),
    ];
  } else {
    entries = [
      ...(L.uncategorized.get(month) ?? []).map((o) => fromOneOff(o, null)),
      ...uncategorizedCard(L, month).map((t) => fromCard(t, null)),
    ];
  }
  return entries.sort((a, b) => b.amount - a.amount);
}

export type MonthSummary = {
  month: string;
  income: number;
  spending: number;
  savings: number;
  /** income − spending − savings: what's left over */
  net: number;
  /** Total of all manual entries this month */
  oneOffs: number;
  /** Anything at all recorded this month */
  hasData: boolean;
};

export function summarizeMonth(L: Ledger, month: string): MonthSummary {
  const totals: Record<CategoryKind, number[]> = { income: [], expense: [], savings: [] };
  let entered = 0;
  for (const item of L.items) {
    if (itemEntered(L, item.id, month)) entered++;
    const v = itemMonthTotal(L, item.id, month);
    const kind = L.kindByCategory.get(item.category_id);
    if (v !== undefined && kind) totals[kind].push(v);
  }
  for (const [catId, byMonth] of L.oneOffsByCategory) {
    const kind = L.kindByCategory.get(catId);
    if (kind) totals[kind].push(sumOneOffs(byMonth.get(month)));
  }
  for (const [catId, byMonth] of L.cardByCategory) {
    const kind = L.kindByCategory.get(catId);
    if (kind) totals[kind].push(sumCard(byMonth.get(month)));
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
    oneOffs: sumOneOffs(monthOneOffs),
    hasData: entered > 0 || monthOneOffs.length > 0 || L.transactions.some((t) => t.month === month && countsOnItsOwn(t)),
  };
}

/** Budget status for display: tone escalates at 90% and over 100%. */
export function budgetStatus(spent: number, budget: number): { pct: number; tone: "ok" | "near" | "over"; label: string } {
  const pct = budget > 0 ? spent / budget : spent > 0 ? Infinity : 0;
  const tone = pct > 1 ? "over" : pct >= 0.9 ? "near" : "ok";
  const diff = sumMoney([budget, -spent]);
  const label = diff >= 0 ? `${formatMoney(diff)} left` : `${formatMoney(-diff)} over`;
  return { pct, tone, label };
}

/** "Vacations › Plane fare", "Personal", or "Needs a category" */
export function oneOffTarget(o: OneOff, categories: Category[], items: LineItem[]): string {
  const item = o.line_item_id ? items.find((i) => i.id === o.line_item_id) : undefined;
  const cat = categories.find((c) => c.id === (item?.category_id ?? o.category_id));
  if (item && cat) return `${cat.name} › ${item.name}`;
  if (cat) return cat.name;
  return "Needs a category";
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
