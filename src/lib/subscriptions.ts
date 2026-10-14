// Find subscriptions in card charges: a merchant charging about the same amount every month
// (or every year). Pure functions over loaded transactions, so they can be tested directly.
import { addMonths, sumMoney } from "@/lib/budget";
import type { Transaction } from "@/lib/transactions";

export type Cadence = "monthly" | "yearly";

export type Subscription = {
  /** Stable id for hiding: merchant, plus the amount band when a merchant bills several (Apple, Google) */
  key: string;
  merchant: string;
  cadence: Cadence;
  /** Latest charge */
  amount: number;
  lastChargedOn: string;
  /** Next expected charge (YYYY-MM-DD) */
  nextExpectedOn: string;
  monthlyCost: number;
  yearlyCost: number;
  /** Charging until recently, but nothing for over 1.5 cycles */
  stopped: boolean;
  /** First seen within the last few months (and not just where the loaded data starts) */
  isNew: boolean;
  /** The latest price differs from the one before it */
  priceChange: { from: number; since: string } | null;
  /** Every charge in the series, newest first */
  charges: Transaction[];
};

/** How close a charge must be to the series' latest amount to belong to it */
const AMOUNT_TOLERANCE = 0.2;
/** Consecutive charges this close count as the same price */
const STEADY = 0.02;
const MONTHLY_GAP = [25, 40] as const;
const YEARLY_GAP = [350, 380] as const;
/** Days without a charge after which a subscription counts as stopped */
const STOPPED_AFTER: Record<Cadence, number> = { monthly: 45, yearly: 400 };
/** Stopped ones are shown this long after their last charge, then dropped */
const SHOW_STOPPED_FOR = 90;

const DAY = 86_400_000;
const toTime = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const daysBetween = (a: string, b: string) => Math.round((toTime(b) - toTime(a)) / DAY);
const addDays = (iso: string, n: number) => new Date(toTime(iso) + n * DAY).toISOString().slice(0, 10);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(a, b) * AMOUNT_TOLERANCE;

/** "2026-01-31" → "2026-02-28": the same day next month, clamped to its length */
function sameDayNextMonth(iso: string): string {
  const next = addMonths(`${iso.slice(0, 7)}-01`, 1);
  const lastDay = Number(addDays(addMonths(next, 1), -1).slice(8, 10));
  return `${next.slice(0, 8)}${String(Math.min(Number(iso.slice(8, 10)), lastDay)).padStart(2, "0")}`;
}

/** Last day of a month key, or `today` when that's earlier (the current month) */
function asOfDay(month: string, today: string): string {
  const end = addDays(addMonths(month, 1), -1);
  return today < end ? today : end;
}

/**
 * Split one merchant's charges into series of similar amounts, oldest first. Each charge joins
 * the series whose latest amount is within 20%, so gradual price increases stay in one series
 * and a merchant billing several subscriptions (Apple at $2.99 and $9.99) gets one per amount.
 */
function seriesOf(charges: Transaction[]): Transaction[][] {
  const out: Transaction[][] = [];
  for (const c of charges) {
    const s = out.find((x) => close(x[x.length - 1].amount, c.amount));
    if (s) s.push(c);
    else out.push([c]);
  }
  return out;
}

/** Whether a series (oldest first) repeats monthly or yearly, judging its most recent charges */
function cadenceOf(series: Transaction[]): Cadence | null {
  const recent = series.slice(-6);
  const gaps = recent.slice(1).map((c, i) => daysBetween(recent[i].posted_on, c.posted_on));
  if (recent.length >= 3) {
    const g = median(gaps);
    const regular = gaps.filter((x) => x >= MONTHLY_GAP[0] && x <= MONTHLY_GAP[1]).length;
    // Subscriptions bill the same amount month after month (bar a price change); a store visited
    // monthly at drifting amounts doesn't count
    const steady = recent.slice(1).filter((c, i) => Math.abs(c.amount - recent[i].amount) <= recent[i].amount * STEADY).length;
    // Mostly monthly gaps: one skipped or doubled month doesn't break it
    if (g >= MONTHLY_GAP[0] && g <= MONTHLY_GAP[1] && regular >= gaps.length - 1 && regular >= 2 && steady * 2 >= gaps.length)
      return "monthly";
  }
  const last = gaps[gaps.length - 1];
  if (series.length >= 2 && last >= YEARLY_GAP[0] && last <= YEARLY_GAP[1]) return "yearly";
  return null;
}

/**
 * Subscriptions as of the end of `asOf` (a month key; for the current month, as of `today`).
 * Uses counted and covered card charges; excluded ones (card payments) and credits are ignored.
 * Active ones come first, most expensive first.
 */
export function findSubscriptions(
  transactions: Transaction[],
  asOf: string,
  today: string = new Date().toISOString().slice(0, 10)
): Subscription[] {
  const end = asOfDay(asOf, today);
  const charges = transactions
    .filter((t) => !t.excluded && t.amount > 0 && t.posted_on <= end)
    .sort((a, b) => a.posted_on.localeCompare(b.posted_on) || a.id.localeCompare(b.id));
  if (!charges.length) return [];
  const dataStart = charges[0].posted_on;

  const byMerchant = new Map<string, Transaction[]>();
  for (const c of charges) {
    const name = c.merchant || c.description;
    byMerchant.set(name, [...(byMerchant.get(name) ?? []), c]);
  }

  const out: Subscription[] = [];
  for (const [merchant, list] of byMerchant) {
    const all = seriesOf(list);
    for (const series of all) {
      const cadence = cadenceOf(series);
      if (!cadence) continue;
      const last = series[series.length - 1];
      const sinceLast = daysBetween(last.posted_on, end);
      const stopped = sinceLast > STOPPED_AFTER[cadence];
      if (stopped && sinceLast > STOPPED_AFTER[cadence] + SHOW_STOPPED_FOR) continue;

      // Latest price vs the one before it
      let priceChange: Subscription["priceChange"] = null;
      let i = series.length - 1;
      while (i > 0 && Math.abs(series[i - 1].amount - last.amount) < 0.5) i--;
      if (i > 0) priceChange = { from: series[i - 1].amount, since: series[i].posted_on };

      const first = series[0].posted_on;
      const yearly = cadence === "yearly" ? last.amount : sumMoney([last.amount * 12]);
      out.push({
        key: all.length > 1 ? `${merchant}|${Math.round(last.amount)}` : merchant,
        merchant,
        cadence,
        amount: last.amount,
        lastChargedOn: last.posted_on,
        nextExpectedOn: cadence === "monthly" ? sameDayNextMonth(last.posted_on) : addDays(last.posted_on, 365),
        monthlyCost: cadence === "yearly" ? Math.round((last.amount / 12) * 100) / 100 : last.amount,
        yearlyCost: yearly,
        stopped,
        isNew: cadence === "monthly" && daysBetween(first, end) <= 120 && daysBetween(dataStart, first) > 35,
        priceChange,
        charges: [...series].reverse(),
      });
    }
  }
  return out.sort((a, b) => Number(a.stopped) - Number(b.stopped) || b.monthlyCost - a.monthlyCost);
}
