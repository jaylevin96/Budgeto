import { describe, expect, it } from "vitest";
import { isSearchable, matchesQuery, sortRows, type SearchRow } from "@/lib/search";
import { charge, oneOff } from "@/test/fixtures";

const card: SearchRow = { kind: "card", tx: charge(-42.5, "2026-10-01", { merchant: "WHOLE FOODS", description: "WHOLEFDS #123" }) };
const manual: SearchRow = { kind: "manual", oneOff: oneOff(1200, "2026-10-01", { name: "Hotel", note: "Napa trip" }) };

describe("search", () => {
  it("needs two characters or an amount", () => {
    expect(isSearchable("a")).toBe(false);
    expect(isSearchable("ab")).toBe(true);
    expect(isSearchable("5")).toBe(true);
  });

  it("matches text fields case-insensitively", () => {
    expect(matchesQuery(card, "whole")).toBe(true);
    expect(matchesQuery(manual, "napa")).toBe(true);
    expect(matchesQuery(manual, "whole")).toBe(false);
  });

  it("matches amounts, credits by size", () => {
    expect(matchesQuery(card, "42.50")).toBe(true);
    expect(matchesQuery(manual, "$1,200")).toBe(true);
    expect(matchesQuery(manual, "1201")).toBe(false);
  });

  it("sorts card charges before manual entries on the same day", () => {
    const sameDay: SearchRow = { kind: "card", tx: charge(5, "2026-10-01", { posted_on: "2026-10-01" }) };
    expect(sortRows([manual, sameDay, card]).map((r) => r.kind)).toEqual(["card", "card", "manual"]);
  });
});
