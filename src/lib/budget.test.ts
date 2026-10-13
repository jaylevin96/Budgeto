import { describe, expect, it } from "vitest";
import {
  addMonths,
  budgetFor,
  budgetStatus,
  buildLedger,
  categoryEntriesTotal,
  itemMonthTotal,
  ledgerEntries,
  monthKeyFromSlug,
  parseAmount,
  sumMoney,
  summarizeMonth,
  totalForCategoryMonth,
  uncategorizedTotal,
} from "@/lib/budget";
import { category, charge, item, oneOff } from "@/test/fixtures";

const OCT = "2026-10-01";

describe("month helpers", () => {
  it("adds months across year boundaries", () => {
    expect(addMonths("2026-12-01", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
    expect(addMonths("2026-10-01", -23)).toBe("2024-11-01");
  });

  it("validates month slugs", () => {
    expect(monthKeyFromSlug("2026-10")).toBe(OCT);
    expect(monthKeyFromSlug("2026-13")).toBeNull();
    expect(monthKeyFromSlug(undefined)).toBeNull();
  });
});

describe("money", () => {
  it("parses typed amounts", () => {
    expect(parseAmount("$1,234.5")).toBe(1234.5);
    expect(parseAmount("  ")).toBeNull();
    expect(parseAmount("12.345")).toBeNaN();
    expect(parseAmount("-5")).toBeNaN();
  });

  it("sums without float drift", () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney([19.99, 0.01, -5])).toBe(15);
  });
});

describe("ledger totals", () => {
  const categories = [category("income", "income"), category("home"), category("savings", "savings")];
  const items = [item("rent", "home"), item("wage", "income"), item("k401", "savings")];
  const oneOffs = [
    oneOff(5000, OCT, { line_item_id: "wage", category_id: "income" }),
    oneOff(2000, OCT, { line_item_id: "rent", category_id: "home" }),
    oneOff(150.5, OCT, { category_id: "home" }), // Home's Other row
    oneOff(40, OCT), // no category: uncategorized
    oneOff(500, OCT, { line_item_id: "k401", category_id: "savings" }),
    oneOff(999, "2026-09-01", { line_item_id: "rent", category_id: "home" }), // another month
  ];
  const covering = oneOffs[1];
  const transactions = [
    charge(25.25, OCT, { line_item_id: "rent" }),
    charge(10, OCT, { category_id: "home" }),
    charge(60, OCT), // unfiled
    charge(300, OCT, { line_item_id: "rent", excluded: true }), // card payment: doesn't count
    charge(2000, OCT, { line_item_id: "rent", one_off_id: covering.id }), // covered by the manual entry
  ];
  const L = buildLedger(categories, items, oneOffs, transactions);

  it("totals a line item from manual entries and counted card charges", () => {
    expect(itemMonthTotal(L, "rent", OCT)).toBe(2025.25);
    expect(itemMonthTotal(L, "rent", "2026-08-01")).toBeUndefined();
  });

  it("puts category-only entries and charges in the Other row", () => {
    expect(categoryEntriesTotal(L, "home", OCT)).toBe(160.5);
    expect(totalForCategoryMonth(L, "home", OCT)).toBe(2185.75);
  });

  it("counts entries without a category and unfiled charges as uncategorized", () => {
    expect(uncategorizedTotal(L, OCT)).toBe(100);
  });

  it("summarizes a month, keeping savings out of spending", () => {
    const s = summarizeMonth(L, OCT);
    expect(s.income).toBe(5000);
    expect(s.spending).toBe(2285.75);
    expect(s.savings).toBe(500);
    expect(s.net).toBe(2214.25);
    expect(s.hasData).toBe(true);
    expect(summarizeMonth(L, "2026-08-01").hasData).toBe(false);
  });

  it("lists entries that add up to the matching total, largest first", () => {
    const entries = ledgerEntries(L, { kind: "category", id: "home" }, OCT);
    expect(sumMoney(entries.map((e) => e.amount))).toBe(totalForCategoryMonth(L, "home", OCT));
    expect(entries.map((e) => e.amount)).toEqual([2000, 150.5, 25.25, 10]);
    const loose = ledgerEntries(L, { kind: "uncategorized" }, OCT);
    expect(sumMoney(loose.map((e) => e.amount))).toBe(uncategorizedTotal(L, OCT));
  });
});

describe("budgets", () => {
  const home = category("home", "expense", {
    budgets: [
      { id: "b1", category_id: "home", amount: 2000, start_month: "2026-01-01" },
      { id: "b2", category_id: "home", amount: 2500, start_month: "2026-07-01" },
      { id: "b3", category_id: "home", amount: null, start_month: "2026-11-01" },
    ],
  });

  it("uses the latest change on or before the month", () => {
    expect(budgetFor(home, "2025-12-01")).toBeNull();
    expect(budgetFor(home, "2026-03-01")).toBe(2000);
    expect(budgetFor(home, "2026-07-01")).toBe(2500);
    expect(budgetFor(home, "2026-12-01")).toBeNull();
  });

  it("never budgets income", () => {
    expect(budgetFor({ ...home, kind: "income" }, "2026-03-01")).toBeNull();
  });

  it("escalates tone at 90% and over 100%", () => {
    expect(budgetStatus(50, 100)).toMatchObject({ tone: "ok", label: "$50 left" });
    expect(budgetStatus(90, 100).tone).toBe("near");
    expect(budgetStatus(120, 100)).toMatchObject({ tone: "over", label: "$20 over" });
    expect(budgetStatus(5, 0).pct).toBe(Infinity);
  });
});
