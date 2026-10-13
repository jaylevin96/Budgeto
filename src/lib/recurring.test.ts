import { describe, expect, it } from "vitest";
import {
  activeIn,
  cadenceLabel,
  dueMonths,
  monthsNeedingAmount,
  needingAmount,
  nextDue,
  onSchedule,
  type RecurringEntry,
} from "@/lib/recurring";
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
    every_months: 1,
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

describe("entries that don't come every month", () => {
  const insurance = entry({ name: "Car insurance", start_month: "2026-02-01", every_months: 6 });
  const fee = entry({ name: "Card fee", start_month: "2025-11-01", every_months: 12, skip_months: ["2026-11-01"] });

  it("is due only on its cadence from the start month", () => {
    expect(onSchedule(insurance, "2026-02-01")).toBe(true);
    expect(onSchedule(insurance, "2026-08-01")).toBe(true);
    expect(onSchedule(insurance, "2027-02-01")).toBe(true);
    expect(onSchedule(insurance, "2026-05-01")).toBe(false);
    expect(onSchedule(insurance, "2025-08-01")).toBe(false);
    expect(activeIn(insurance, "2026-03-01")).toBe(false);
    expect(activeIn(insurance, "2026-08-01")).toBe(true);
  });

  it("fills in only due months", () => {
    expect(dueMonths(insurance, new Set(), "2027-03-01")).toEqual(["2026-02-01", "2026-08-01", "2027-02-01"]);
    expect(dueMonths(fee, new Set(), "2027-12-01")).toEqual(["2025-11-01", "2027-11-01"]);
    expect(dueMonths({ ...insurance, end_month: "2026-12-01" }, new Set(), "2027-12-01")).toEqual(["2026-02-01", "2026-08-01"]);
  });

  it("asks for a varying amount only in due months", () => {
    const water = { ...insurance, id: "water", amount_varies: true, every_months: 3 };
    expect(needingAmount([water], [], "2026-05-01").map((r) => r.id)).toEqual(["water"]);
    expect(needingAmount([water], [], "2026-06-01")).toEqual([]);
  });

  it("finds the next due month, skipping skips and stopping at the end", () => {
    expect(nextDue(insurance, "2026-02-01")).toBe("2026-08-01");
    expect(nextDue(insurance, "2026-05-01")).toBe("2026-08-01");
    expect(nextDue(insurance, "2025-01-01")).toBe("2026-02-01");
    expect(nextDue(fee, "2026-01-01")).toBe("2027-11-01");
    expect(nextDue({ ...insurance, end_month: "2026-08-01" }, "2026-08-01")).toBeNull();
    expect(nextDue(entry(), "2026-10-01")).toBe("2026-11-01");
  });

  it("labels cadences", () => {
    expect(cadenceLabel(1)).toBe("every month");
    expect(cadenceLabel(6)).toBe("every 6 months");
    expect(cadenceLabel(12)).toBe("every year");
  });
});
