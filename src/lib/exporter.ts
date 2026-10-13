import {
  categoryOneOffs,
  formatMonth,
  itemMonthTotal,
  monthKey,
  sumMoney,
  summarizeMonth,
  type Ledger,
  type OneOff,
} from "@/lib/budget";

const HEADER_MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

type Cell = string | number | null;

/**
 * Download a year as .xlsx in the same layout as the original budget spreadsheet:
 * one section per category (SECTION | JAN … DEC | YEAR, rows, Total), then TOTALS.
 * Line-item cells include their linked one-offs; category-only one-offs appear as rows
 * in their section. A second sheet lists every one-off. The file parses with the importer
 * (one-offs come back as regular line items), so it is meant for backup or a fresh account,
 * not for re-importing into the same account (linked one-offs would be counted twice).
 */
export async function exportYear(year: number, L: Ledger): Promise<void> {
  const XLSX = await import("xlsx");
  const months = Array.from({ length: 12 }, (_, m) => monthKey(year, m));
  const rows: Cell[][] = [[null, `Monthly Budget ${year}`], []];
  const yearOneOffs = L.oneOffs.filter((o) => o.month.startsWith(`${year}-`));

  const pushSection = (title: string, lines: { name: string; values: (number | null)[] }[]) => {
    rows.push([null, title.toUpperCase(), ...HEADER_MONTHS, "YEAR"]);
    for (const line of lines) {
      rows.push([null, line.name, ...line.values, sumMoney(line.values.map((v) => v ?? 0))]);
    }
    const totals = months.map((_, i) => sumMoney(lines.map((l) => l.values[i] ?? 0)));
    rows.push([null, "Total", ...totals, sumMoney(totals)]);
    rows.push([]);
  };

  for (const cat of L.categories) {
    const items = L.items.filter((i) => i.category_id === cat.id);
    const lines = items.map((item) => ({
      name: item.name,
      values: months.map((m) => itemMonthTotal(L, item.id, m) ?? null),
    }));
    // Category-only one-offs: one row per one-off name
    const catOneOffs = months.flatMap((m) => categoryOneOffs(L, cat.id, m));
    for (const [name, list] of groupByName(catOneOffs)) {
      lines.push({ name, values: months.map((m) => sumOrNull(list.filter((o) => o.month === m))) });
    }
    const hasAny = lines.some((l) => l.values.some((v) => v !== null));
    if (cat.archived && !hasAny) continue;
    pushSection(cat.name, lines);
  }

  const uncategorized = months.flatMap((m) => L.uncategorized.get(m) ?? []);
  if (uncategorized.length) {
    pushSection(
      "Uncategorized One-offs",
      [...groupByName(uncategorized)].map(([name, list]) => ({
        name,
        values: months.map((m) => sumOrNull(list.filter((o) => o.month === m))),
      }))
    );
  }

  const summaries = months.map((m) => summarizeMonth(L, m));
  rows.push([null, "TOTALS", ...HEADER_MONTHS, "YEAR"]);
  const totalRow = (label: string, values: number[]) => rows.push([null, label, ...values, sumMoney(values)]);
  totalRow("Total income", summaries.map((s) => s.income));
  totalRow("Total spending", summaries.map((s) => s.spending));
  totalRow("Total saved", summaries.map((s) => s.savings));
  totalRow("Left over", summaries.map((s) => s.net));

  const budgetSheet = XLSX.utils.aoa_to_sheet(rows);
  budgetSheet["!cols"] = [{ wch: 2 }, { wch: 28 }, ...HEADER_MONTHS.map(() => ({ wch: 10 })), { wch: 12 }];
  setMoneyFormat(XLSX, budgetSheet, rows);

  const itemName = new Map(L.items.map((i) => [i.id, i.name]));
  const catName = new Map(L.categories.map((c) => [c.id, c.name]));
  const oneOffRows: Cell[][] = [["Month", "Name", "Amount", "Category", "Line item", "Note"]];
  for (const o of [...yearOneOffs].sort((a, b) => a.month.localeCompare(b.month))) {
    const item = o.line_item_id ? L.items.find((i) => i.id === o.line_item_id) : undefined;
    oneOffRows.push([
      formatMonth(o.month, "short"),
      o.name,
      o.amount,
      catName.get(item?.category_id ?? o.category_id ?? "") ?? "Uncategorized",
      item ? itemName.get(item.id) ?? "" : "",
      o.note ?? "",
    ]);
  }
  const oneOffSheet = XLSX.utils.aoa_to_sheet(oneOffRows);
  oneOffSheet["!cols"] = [{ wch: 10 }, { wch: 28 }, { wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 40 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, budgetSheet, "PERSONAL BUDGET");
  XLSX.utils.book_append_sheet(wb, oneOffSheet, "One-offs");
  XLSX.writeFile(wb, `Budgeto_${year}.xlsx`);
}

function groupByName(list: OneOff[]): Map<string, OneOff[]> {
  const out = new Map<string, OneOff[]>();
  for (const o of list) out.set(o.name, [...(out.get(o.name) ?? []), o]);
  return out;
}

function sumOrNull(list: OneOff[]): number | null {
  return list.length ? sumMoney(list.map((o) => o.amount)) : null;
}

function setMoneyFormat(XLSX: typeof import("xlsx"), sheet: import("xlsx").WorkSheet, rows: Cell[][]) {
  rows.forEach((row, r) =>
    row.forEach((v, c) => {
      if (typeof v !== "number") return;
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell) cell.z = "$#,##0.00";
    })
  );
}
