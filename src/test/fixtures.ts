import type { Category, CategoryKind, LineItem, OneOff } from "@/lib/budget";
import type { Transaction } from "@/lib/transactions";

export function category(id: string, kind: CategoryKind = "expense", extra: Partial<Category> = {}): Category {
  return { id, name: id, kind, sort_order: 0, archived: false, budgets: [], ...extra };
}

export function item(id: string, categoryId: string, extra: Partial<LineItem> = {}): LineItem {
  return { id, category_id: categoryId, name: id, recurrence: "none", default_amount: null, sort_order: 0, archived: false, ...extra };
}

let seq = 0;

export function oneOff(amount: number, month: string, extra: Partial<OneOff> = {}): OneOff {
  return { id: `o${++seq}`, name: "Entry", amount, month, category_id: null, line_item_id: null, note: null, recurring_id: null, ...extra };
}

export function charge(amount: number, month: string, extra: Partial<Transaction> = {}): Transaction {
  return {
    id: `t${++seq}`,
    import_id: "imp",
    posted_on: `${month.slice(0, 7)}-15`,
    month,
    description: "CHARGE",
    merchant: "MERCHANT",
    card_member: null,
    source_category: null,
    amount,
    line_item_id: null,
    category_id: null,
    one_off_id: null,
    excluded: false,
    ...extra,
  };
}
