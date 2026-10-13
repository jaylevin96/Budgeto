import { describe, expect, it } from "vitest";
import type { StatementRow } from "@/lib/amex";
import { buildReview } from "@/lib/cardReview";

function row(id: string, amount: number, merchant = "HOTEL"): StatementRow {
  return {
    externalId: id,
    postedOn: "2026-10-05",
    month: "2026-10-01",
    description: merchant,
    merchant,
    cardMember: null,
    sourceCategory: null,
    amount,
    splitOf: null,
  };
}

describe("buildReview", () => {
  const hotel = { id: "hotel", name: "Hotel", amount: 500, month: "2026-10-01" };

  it("links a charge close to a manual entry's amount", () => {
    const review = buildReview([row("a", 499.5), row("b", 20, "CAFE")], [], [], [], [hotel], new Set());
    expect(review.find((r) => r.row.externalId === "a")).toMatchObject({ value: "oneoff:hotel", reason: "matches one-off" });
    expect(review.find((r) => r.row.externalId === "b")?.value).toBe("");
  });

  it("links several charges from one merchant that add up to the entry", () => {
    const review = buildReview([row("a", 300), row("b", 200)], [], [], [], [hotel], new Set());
    expect(review.every((r) => r.value === "oneoff:hotel")).toBe(true);
  });

  it("leaves entries already covered by an earlier import alone", () => {
    const review = buildReview([row("a", 500)], [], [], [], [hotel], new Set(["hotel"]));
    expect(review[0].value).toBe("");
  });

  it("doesn't match outside the tolerance or month", () => {
    const review = buildReview([row("a", 450), { ...row("b", 500), month: "2026-09-01" }], [], [], [], [hotel], new Set());
    expect(review.every((r) => r.value === "")).toBe(true);
  });
});
