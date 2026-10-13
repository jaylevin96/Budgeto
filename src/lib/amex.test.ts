import { describe, expect, it } from "vitest";
import { categorize, cleanMerchant, normalizeMerchant, parseAmexStatement, type Rule, type StatementRow } from "@/lib/amex";

function row(extra: Partial<StatementRow>): StatementRow {
  return {
    externalId: "x",
    postedOn: "2026-10-05",
    month: "2026-10-01",
    description: "SOMETHING",
    merchant: "SOMETHING",
    cardMember: null,
    sourceCategory: null,
    amount: 10,
    splitOf: null,
    ...extra,
  };
}

const categories = [{ id: "daily", name: "Daily Living" }, { id: "subs", name: "Subscriptions" }];
const items = [
  { id: "dining", name: "Dining out", category_id: "daily" },
  { id: "groceries", name: "Groceries", category_id: "daily" },
  { id: "netflix", name: "Netflix", category_id: "subs" },
];

describe("merchant names", () => {
  it("strips processor prefixes and store numbers", () => {
    expect(cleanMerchant("AplPay TST* CHIPOTLE 0042")).toBe("CHIPOTLE");
    expect(cleanMerchant("SQ *BLUE BOTTLE #11445")).toBe("BLUE BOTTLE");
  });

  it("prefers the untruncated name from Extended Details", () => {
    expect(normalizeMerchant("CRATE & BARREL ONLINCHICAGO", "x\nCRATE & BARREL ONLINE STORE")).toBe("CRATE & BARREL ONLINE STORE");
  });
});

describe("categorize", () => {
  it("excludes card payments", () => {
    const [a] = categorize([row({ description: "AUTOPAY PAYMENT - THANK YOU" })], [], items, categories);
    expect(a).toMatchObject({ excluded: true, reason: "payment" });
  });

  it("applies the user's merchant rule before built-in guesses", () => {
    const rules: Rule[] = [{ match_type: "merchant", pattern: "NETFLIX.COM", line_item_id: "dining", exclude: false }];
    const [a] = categorize([row({ merchant: "NETFLIX.COM" })], rules, items, categories);
    expect(a).toMatchObject({ lineItemId: "dining", reason: "merchant rule" });
  });

  it("guesses from merchant and Amex category when a matching line item exists", () => {
    const [netflix, groceries, unknown] = categorize(
      [
        row({ merchant: "NETFLIX.COM" }),
        row({ merchant: "JEWEL", sourceCategory: "Merchandise & Supplies-Groceries" }),
        row({ merchant: "ACME" }),
      ],
      [],
      items,
      categories
    );
    expect(netflix).toMatchObject({ lineItemId: "netflix", reason: "suggested" });
    expect(groceries).toMatchObject({ lineItemId: "groceries", reason: "suggested" });
    expect(unknown).toMatchObject({ lineItemId: null, reason: "none" });
  });

  it("files a split credit like its original charge", () => {
    const [, split] = categorize(
      [row({ merchant: "PEETS", amount: 20 }), row({ merchant: "PEETS", amount: -10, splitOf: "PEETS" })],
      [],
      items,
      categories
    );
    expect(split).toMatchObject({ lineItemId: "dining", reason: "split" });
  });
});

describe("parseAmexStatement", () => {
  it("parses a basic CSV export", async () => {
    const csv = [
      "Date,Description,Amount",
      "09/24/2026,NETFLIX.COM,15.49",
      "09/24/2026,NETFLIX.COM,15.49",
      "09/25/2026,AUTOPAY PAYMENT - THANK YOU,-500.00",
    ].join("\n");
    const data = new TextEncoder().encode(csv).buffer as ArrayBuffer;
    const parsed = await parseAmexStatement(data);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[0]).toMatchObject({ postedOn: "2026-09-24", month: "2026-09-01", merchant: "NETFLIX.COM", amount: 15.49 });
    expect(parsed.rows[2].amount).toBe(-500);
    // Identical rows get distinct ids
    expect(parsed.rows[0].externalId).not.toBe(parsed.rows[1].externalId);
  });

  it("rejects a file without the header row", async () => {
    const data = new TextEncoder().encode("a,b\n1,2").buffer as ArrayBuffer;
    await expect(parseAmexStatement(data)).rejects.toThrow(/Amex export/);
  });
});
