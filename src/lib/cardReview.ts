// Prepare an Amex statement for the review screen. Pure (type-only imports), so it can be
// checked against a sample file directly.
import { categorize, type Assignment, type Rule, type StatementRow } from "@/lib/amex";

type Named = { id: string; name: string };
type Item = Named & { category_id: string; archived?: boolean };
type OneOffLike = { id: string; name: string; amount: number; month: string };

/** Charges at or above this are pre-marked "one-off" so they show with big purchases */
export const ONE_OFF_THRESHOLD = 500;

export type ReviewRow = {
  row: StatementRow;
  /** Select value: "", "exclude", "oneoff:<id>" or a line item id */
  value: string;
  makeOneOff: boolean;
  reason: Assignment["reason"] | "matches one-off";
  /** Changed by hand on the review screen (those choices get remembered as rules) */
  touched: boolean;
};

const EXCLUDE = "exclude";
const ONE_OFF = "oneoff:";
const cents = (n: number) => Math.round(n * 100);
const close = (a: number, b: number) => Math.abs(cents(a) - cents(b)) <= Math.max(100, Math.abs(cents(b)) * 0.01);

/**
 * Categorize the new rows, then look for purchases already entered by hand as one-offs:
 * a one-off in the same month whose amount matches one charge, or the sum of one
 * merchant's charges, is linked to them so the money isn't counted twice.
 */
export function buildReview(
  rows: StatementRow[],
  rules: Rule[],
  items: Item[],
  categories: Named[],
  oneOffs: OneOffLike[],
  /** One-offs that card charges already point at (from earlier imports) */
  coveredOneOffIds: Set<string>
): ReviewRow[] {
  const assignments = categorize(rows, rules, items, categories);
  const review: ReviewRow[] = rows.map((row, i) => {
    const a = assignments[i];
    return {
      row,
      value: a.excluded ? EXCLUDE : a.lineItemId ?? "",
      makeOneOff: !a.excluded && row.amount >= ONE_OFF_THRESHOLD,
      reason: a.reason,
      touched: false,
    };
  });

  const free = (r: ReviewRow) => r.row.amount > 0 && r.value !== EXCLUDE && !r.value.startsWith(ONE_OFF);
  const link = (list: ReviewRow[], oneOffId: string) => {
    for (const r of list) {
      r.value = ONE_OFF + oneOffId;
      r.makeOneOff = false;
      r.reason = "matches one-off";
    }
  };
  // Largest first so a big one-off claims its charge before a smaller one could
  for (const o of [...oneOffs].filter((o) => !coveredOneOffIds.has(o.id)).sort((a, b) => b.amount - a.amount)) {
    const candidates = review.filter((r) => r.row.month === o.month && free(r));
    const single = candidates
      .filter((r) => close(r.row.amount, o.amount))
      .sort((a, b) => Math.abs(a.row.amount - o.amount) - Math.abs(b.row.amount - o.amount))[0];
    if (single) {
      link([single], o.id);
      continue;
    }
    const byMerchant = new Map<string, ReviewRow[]>();
    for (const r of candidates) byMerchant.set(r.row.merchant, [...(byMerchant.get(r.row.merchant) ?? []), r]);
    for (const list of byMerchant.values()) {
      if (list.length > 1 && close(list.reduce((s, r) => s + r.row.amount, 0), o.amount)) {
        link(list, o.id);
        break;
      }
    }
  }

  // Needs attention first (uncategorized), then newest first
  return review.sort(
    (a, b) => Number(a.value !== "") - Number(b.value !== "") || b.row.postedOn.localeCompare(a.row.postedOn)
  );
}
