// Gentle checks while entering an amount: an amount far from the usual, or what looks like a
// duplicate. Pure functions over the loaded ledger; they only warn, never block saving.
import {
  categoryCard,
  categoryOneOffs,
  formatMoney,
  itemCard,
  itemOneOffs,
  addMonths,
  sumMoney,
  type Ledger,
  type OneOff,
} from "@/lib/budget";
import type { Transaction } from "@/lib/transactions";

/** Where an entry goes: a line item, or a category's Other row when there's no line item */
export type EntryTarget = { month: string; category_id: string | null; line_item_id: string | null };

/** How far back to look for months with data, and how many of them make "usual" */
const LOOKBACK = 6;
const SAMPLE = 3;

const cents = (n: number) => Math.round(n * 100);

/** Manual entries and counted card charges that make up the target's total in `month` */
function entriesIn(L: Ledger, t: EntryTarget, month: string): { oneOffs: OneOff[]; card: Transaction[] } {
  if (t.line_item_id) return { oneOffs: itemOneOffs(L, t.line_item_id, month), card: itemCard(L, t.line_item_id, month) };
  if (t.category_id) return { oneOffs: categoryOneOffs(L, t.category_id, month), card: categoryCard(L, t.category_id, month) };
  return { oneOffs: [], card: [] };
}

/**
 * The target's usual monthly total: the average of the last 3 months with anything in them
 * (looking back up to 6 months before `t.month`). `single` is true when those months each had
 * one entry, like a utility bill. Null with fewer than 2 such months.
 */
export function usualMonthTotal(L: Ledger, t: EntryTarget): { usual: number; single: boolean } | null {
  const totals: number[] = [];
  let single = true;
  for (let k = 1; k <= LOOKBACK && totals.length < SAMPLE; k++) {
    const { oneOffs, card } = entriesIn(L, t, addMonths(t.month, -k));
    const count = oneOffs.length + card.length;
    if (!count) continue;
    totals.push(sumMoney([...oneOffs.map((o) => o.amount), ...card.map((c) => c.amount)]));
    if (count > 1) single = false;
  }
  if (totals.length < 2) return null;
  return { usual: sumMoney(totals) / totals.length, single };
}

/** "Comed is usually about $110" when `amount` is over 2× (or, for single bills, under half) the usual */
export function amountWarning(label: string, amount: number, usual: number, single: boolean, per = "a month"): string | null {
  if (usual <= 0 || amount <= 0) return null;
  if (amount > usual * 2 || (single && amount < usual / 2)) {
    return `${label} is usually about ${formatMoney(usual)} ${per}. Double-check the amount?`;
  }
  return null;
}

/** Name shown in warnings: the line item, or "Home (Other)" */
function targetLabel(L: Ledger, t: EntryTarget): string {
  const item = t.line_item_id ? L.items.find((i) => i.id === t.line_item_id) : undefined;
  if (item) return item.name;
  const cat = L.categories.find((c) => c.id === t.category_id);
  return cat ? `${cat.name} (Other)` : "This";
}

/** Something already in the target's month with the same amount (to the cent) */
export function findDuplicate(
  L: Ledger,
  t: EntryTarget,
  amount: number,
  excludeId?: string
): { name: string; amount: number; source: "manual" | "card" } | null {
  if (amount <= 0) return null;
  const { oneOffs, card } = entriesIn(L, t, t.month);
  const o = oneOffs.find((x) => x.id !== excludeId && cents(x.amount) === cents(amount));
  if (o) return { name: o.name, amount: o.amount, source: "manual" };
  const c = card.find((x) => cents(x.amount) === cents(amount));
  if (c) return { name: c.merchant || c.description, amount: c.amount, source: "card" };
  return null;
}

/**
 * Warnings for saving `amount` to `t` (editing `excludeId`, if given). The month total with
 * this entry is compared against the usual, so several small entries (groceries) don't warn.
 */
export function entryWarnings(L: Ledger, t: EntryTarget, amount: number, excludeId?: string): string[] {
  if (!t.line_item_id && !t.category_id) return [];
  const out: string[] = [];
  const dup = findDuplicate(L, t, amount, excludeId);
  if (dup) {
    out.push(
      dup.source === "card"
        ? `A card charge at ${dup.name} for ${formatMoney(dup.amount, true)} is already here this month. Adding this counts it twice; link the charge instead if it's the same purchase.`
        : `“${dup.name}” for ${formatMoney(dup.amount, true)} is already here this month. Is this a duplicate?`
    );
  }
  const usual = usualMonthTotal(L, t);
  if (usual) {
    const { oneOffs, card } = entriesIn(L, t, t.month);
    const others = sumMoney([...oneOffs.filter((o) => o.id !== excludeId).map((o) => o.amount), ...card.map((c) => c.amount)]);
    const total = sumMoney([others, amount]);
    const label = targetLabel(L, t);
    // Low amounts only warn for single bills, and only when this would be the month's only entry
    const warning = amountWarning(label, total, usual.usual, usual.single && others === 0);
    if (warning) out.push(others ? warning.replace(" a month.", ` a month; this makes it ${formatMoney(total)}.`) : warning);
  }
  return out;
}
