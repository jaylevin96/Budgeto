import { describe, expect, it } from "vitest";
import { activeIn, dueMonths, monthsNeedingAmount, needingAmount, type RecurringEntry } from "@/lib/recurring";
import { oneOff } from "@/test/fixtures";

function entry(extra: Partial<RecurringEntry> = {}): RecurringEntry {
  return {
    id: "r1",
    name: "Rent",
    amount: 2000,
    category_id: "home",
    line_item_id: null,
    note: null,
    start_month: "2026-01-01",
    end_month: null,
    skip_months: [],
    amount_varies: false,
    ...extra,
  };
}

describe("activeIn", () => {
  it("covers months in range that aren't skipped", () => {
    const r = entry({ end_month: "2026-06-01", skip_months: ["2026-03-01"] });
    expect(activeIn(r, "2025-12-01")).toBe(false);
    expect(activeIn(r, "2026-01-01")).toBe(true);
    expect(activeIn(r, "2026-03-01")).toBe(false);
    expect(activeIn(r, "2026-06-01")).toBe(true);
    expect(activeIn(r, "2026-07-01")).toBe(false);
  });
});

describe("dueMonths", () => {
  it("lists missing months through `through`, never past it", () => {
    const r = entry({ skip_months: ["2026-02-01"] });
    expect(dueMonths(r, new Set(["2026-01-01"]), "2026-04-01")).toEqual(["2026-03-01", "2026-04-01"]);
  });

  it("stops at the end month", () => {
    const r = entry({ end_month: "2026-02-01" });
    expect(dueMonths(r, new Set(), "2026-12-01")).toEqual(["2026-01-01", "2026-02-01"]);
  });

  it("is empty before the start", () => {
    expect(dueMonths(entry({ start_month: "2027-01-01" }), new Set(), "2026-12-01")).toEqual([]);
  });
});

describe("amounts still needed", () => {
  const varies = entry({ id: "gas", amount_varies: true, start_month: "2026-08-01" });

  it("lists a varying entry's missing months, newest first", () => {
    expect(monthsNeedingAmount(varies, new Set(["2026-09-01"]), "2026-10-01")).toEqual(["2026-10-01", "2026-08-01"]);
    expect(monthsNeedingAmount(entry(), new Set(), "2026-10-01")).toEqual([]);
  });

  it("finds varying entries with nothing entered for a past month", () => {
    const entered = [oneOff(80, "2026-09-01", { recurring_id: "gas" })];
    expect(needingAmount([varies, entry()], entered, "2026-08-01").map((r) => r.id)).toEqual(["gas"]);
    expect(needingAmount([varies], entered, "2026-09-01")).toEqual([]);
  });

  it("never asks about future months", () => {
    expect(needingAmount([varies], [], "2999-01-01")).toEqual([]);
  });
});
