import { describe, expect, it } from "vitest";
import { buildLedger } from "@/lib/budget";
import { amountWarning, entryWarnings, findDuplicate, usualMonthTotal } from "@/lib/checks";
import { category, charge, item, oneOff } from "@/test/fixtures";

const OCT = "2026-10-01";
const categories = [category("home"), category("daily")];
const items = [item("comed", "home", { name: "Comed" }), item("groceries", "daily", { name: "Groceries" })];
const comed = (amount: number, month: string) => oneOff(amount, month, { name: "Comed", line_item_id: "comed", category_id: "home" });
const oneOffs = [
  comed(100, "2026-07-01"),
  comed(110, "2026-08-01"),
  comed(120, "2026-09-01"),
  comed(115, OCT),
  oneOff(40, OCT, { name: "Lamp", category_id: "home" }),
];
const transactions = [
  ...["2026-08-01", "2026-09-01"].flatMap((m) => [
    charge(150, m, { line_item_id: "groceries" }),
    charge(150, m, { line_item_id: "groceries" }),
  ]),
  charge(80, OCT, { line_item_id: "groceries", merchant: "JEWEL" }),
];
const L = buildLedger(categories, items, oneOffs, transactions);
const comedNov = { month: "2026-11-01", category_id: "home", line_item_id: "comed" };
const groceriesOct = { month: OCT, category_id: "daily", line_item_id: "groceries" };

describe("usualMonthTotal", () => {
  it("averages the last 3 months with data", () => {
    expect(usualMonthTotal(L, comedNov)).toEqual({ usual: 115, single: true });
    expect(usualMonthTotal(L, groceriesOct)).toEqual({ usual: 300, single: false });
  });

  it("needs at least 2 months", () => {
    expect(usualMonthTotal(L, { month: "2026-08-01", category_id: "home", line_item_id: "comed" })).toBeNull();
  });
});

describe("amountWarning", () => {
  it("warns over 2× and, for single bills, under half", () => {
    expect(amountWarning("Comed", 1150, 115, true)).toMatch(/usually about \$115/);
    expect(amountWarning("Comed", 50, 115, true)).toMatch(/usually/);
    expect(amountWarning("Comed", 50, 115, false)).toBeNull();
    expect(amountWarning("Comed", 200, 115, true)).toBeNull();
  });
});

describe("findDuplicate", () => {
  it("finds a manual entry with the same amount in the same place and month", () => {
    expect(findDuplicate(L, { month: OCT, category_id: "home", line_item_id: "comed" }, 115)).toMatchObject({ name: "Comed" });
    expect(findDuplicate(L, { month: OCT, category_id: "home", line_item_id: null }, 40)).toMatchObject({ name: "Lamp" });
    expect(findDuplicate(L, { month: OCT, category_id: "home", line_item_id: "comed" }, 40)).toBeNull();
  });

  it("ignores the entry being edited", () => {
    expect(findDuplicate(L, { month: OCT, category_id: "home", line_item_id: "comed" }, 115, oneOffs[3].id)).toBeNull();
  });

  it("finds a card charge already filed there", () => {
    expect(findDuplicate(L, groceriesOct, 80)).toMatchObject({ name: "JEWEL", source: "card" });
  });
});

describe("entryWarnings", () => {
  it("warns about a 10× bill", () => {
    expect(entryWarnings(L, comedNov, 1150)).toEqual([expect.stringMatching(/Comed is usually about \$115/)]);
    expect(entryWarnings(L, comedNov, 118)).toEqual([]);
  });

  it("judges the month's total, so small entries in a busy line don't warn", () => {
    expect(entryWarnings(L, groceriesOct, 60)).toEqual([]);
    expect(entryWarnings(L, groceriesOct, 700)).toEqual([expect.stringMatching(/this makes it \$780/)]);
  });

  it("flags duplicates", () => {
    expect(entryWarnings(L, groceriesOct, 80)[0]).toMatch(/card charge at JEWEL/);
  });

  it("says nothing without a category", () => {
    expect(entryWarnings(L, { month: OCT, category_id: null, line_item_id: null }, 1e6)).toEqual([]);
  });
});
