import { describe, expect, it } from "vitest";
import { findSubscriptions } from "@/lib/subscriptions";
import { charge } from "@/test/fixtures";

const TODAY = "2026-10-14";
const OCT = "2026-10-01";

/** A charge on a given day */
function on(day: string, amount: number, merchant: string, extra = {}) {
  return charge(amount, `${day.slice(0, 7)}-01`, { posted_on: day, merchant, ...extra });
}

/** Monthly charges on `day` of each month from `from` (YYYY-MM) for `n` months */
function monthly(merchant: string, from: string, n: number, amount: number | ((i: number) => number), day = 5) {
  const [y, m] = from.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    const iso = `${d.toISOString().slice(0, 8)}${String(Math.min(day, last)).padStart(2, "0")}`;
    return on(iso, typeof amount === "number" ? amount : amount(i), merchant);
  });
}

const background = monthly("GROCER", "2025-01", 2, 10); // so data starts in Jan 2025

describe("findSubscriptions", () => {
  it("finds a monthly charge and its price increase", () => {
    const netflix = monthly("NETFLIX.COM", "2025-06", 17, (i) => (i < 12 ? 15.49 : 17.99));
    const [s] = findSubscriptions([...background, ...netflix], OCT, TODAY);
    expect(s).toMatchObject({
      merchant: "NETFLIX.COM",
      cadence: "monthly",
      amount: 17.99,
      monthlyCost: 17.99,
      yearlyCost: 215.88,
      stopped: false,
      isNew: false,
      priceChange: { from: 15.49, since: "2026-06-05" },
      nextExpectedOn: "2026-11-05",
    });
    expect(s.charges[0].posted_on).toBe("2026-10-05");
  });

  it("finds a yearly charge", () => {
    const fee = [on("2025-03-20", 695, "AMEX ANNUAL FEE"), on("2026-03-20", 695, "AMEX ANNUAL FEE")];
    const [s] = findSubscriptions([...background, ...fee], OCT, TODAY);
    expect(s).toMatchObject({ cadence: "yearly", monthlyCost: 57.92, yearlyCost: 695, stopped: false });
  });

  it("ignores a shop visited often at different amounts", () => {
    const amounts = [12.5, 48, 7.25, 90, 33, 61, 18];
    const coffee = monthly("CORNER MARKET", "2026-04", 7, (i) => amounts[i]);
    expect(findSubscriptions([...background, ...coffee], OCT, TODAY)).toEqual([]);
  });

  it("ignores a store visited monthly at drifting amounts", () => {
    const store = monthly("HOME DEPOT", "2026-04", 7, (i) => 80 + i * 3);
    expect(findSubscriptions([...background, ...store], OCT, TODAY)).toEqual([]);
  });

  it("ignores a usage-based bill whose amount swings", () => {
    const amounts = [80, 140, 95, 160, 70, 120];
    const utility = monthly("COMED", "2026-05", 6, (i) => amounts[i]);
    expect(findSubscriptions([...background, ...utility], OCT, TODAY)).toEqual([]);
  });

  it("marks one that stopped as stopped, then drops it", () => {
    const gym = monthly("FLEX GYM", "2026-01", 6, 40); // last charge Jun 5
    expect(findSubscriptions([...background, ...gym], "2026-08-01", TODAY)[0]).toMatchObject({ stopped: true });
    expect(findSubscriptions([...background, ...gym], "2026-06-01", TODAY)[0]).toMatchObject({ stopped: false });
    expect(findSubscriptions([...background, ...gym], "2026-12-01", "2026-12-31")).toEqual([]);
  });

  it("flags a new one, but not one that only looks new because the data starts there", () => {
    const fresh = monthly("SPOTIFY", "2026-08", 3, 11.99);
    expect(findSubscriptions([...background, ...fresh], OCT, TODAY)[0]).toMatchObject({ isNew: true });
    const fromStart = monthly("HULU", "2025-01", 22, 7.99);
    expect(findSubscriptions(fromStart, OCT, TODAY)[0]).toMatchObject({ isNew: false });
  });

  it("ignores excluded charges and credits", () => {
    const payments = monthly("AUTOPAY", "2026-04", 6, 500).map((t) => ({ ...t, excluded: true }));
    const refunds = monthly("REFUNDER", "2026-04", 6, -20);
    expect(findSubscriptions([...background, ...payments, ...refunds], OCT, TODAY)).toEqual([]);
  });

  it("handles month-end billing days (28 to 31 days apart)", () => {
    const end = monthly("ICLOUD", "2026-01", 9, 2.99, 31);
    expect(findSubscriptions([...background, ...end], OCT, TODAY)[0]).toMatchObject({ cadence: "monthly", stopped: false });
  });

  it("splits one merchant billing several subscriptions", () => {
    const apple = [...monthly("APPLE.COM/BILL", "2026-04", 6, 2.99, 3), ...monthly("APPLE.COM/BILL", "2026-04", 6, 9.99, 9)];
    const subs = findSubscriptions([...background, ...apple], OCT, TODAY);
    expect(subs.map((s) => s.amount)).toEqual([9.99, 2.99]);
    expect(new Set(subs.map((s) => s.key)).size).toBe(2);
  });

  it("only counts charges up to the month being viewed", () => {
    const netflix = monthly("NETFLIX.COM", "2026-06", 5, 17.99);
    expect(findSubscriptions([...background, ...netflix], "2026-07-01", TODAY)).toEqual([]);
    expect(findSubscriptions([...background, ...netflix], "2026-08-01", TODAY)).toHaveLength(1);
  });
});
