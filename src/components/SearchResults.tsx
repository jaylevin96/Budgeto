import { useState } from "react";
import { Link } from "react-router-dom";
import { CreditCard, PenLine, Repeat } from "lucide-react";
import { FormError } from "@/components/ui/form-message";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DestinationSelect } from "@/components/CardTransactions";
import {
  formatMoney,
  formatMonth,
  monthSlug,
  saveOneOff,
  sumMoney,
  type Category,
  type CreatedStructure,
  type LineItem,
  type OneOff,
} from "@/lib/budget";
import { rowAmount, rowId, rowMonth, type SearchRow } from "@/lib/search";
import {
  countsOnItsOwn,
  destinationValue,
  formatDay,
  parseDestination,
  updateTransactions,
  type Transaction,
} from "@/lib/transactions";
import { cn } from "@/lib/utils";

const iconClass = "h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]";

/**
 * Search hits as a table: date, what it is, where it's filed and the amount. The line item
 * picker saves right away (card charges: same choices as when filing; manual entries: a
 * category or line item).
 */
export function SearchResults({
  rows,
  categories,
  items,
  oneOffs,
  showMonth = false,
  onTransactionsSaved,
  onOneOffSaved,
  onCreated,
}: {
  rows: SearchRow[];
  categories: Category[];
  items: LineItem[];
  /** Manual entries a card charge could be linked to (matched by month) */
  oneOffs: OneOff[];
  /** Link each row to its month (for results spanning months) */
  showMonth?: boolean;
  onTransactionsSaved: (updated: Transaction[]) => void;
  onOneOffSaved: (id: string, saved: OneOff) => void;
  onCreated?: (created: CreatedStructure) => void;
}) {
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(row: SearchRow, value: string) {
    setSavingId(rowId(row));
    setError(null);
    try {
      const d = parseDestination(value);
      if (row.kind === "card") {
        onTransactionsSaved(await updateTransactions([row.tx.id], d));
      } else {
        // Entries on a line item also carry its category
        const item = d.line_item_id ? items.find((i) => i.id === d.line_item_id) : undefined;
        const { id, ...rest } = row.oneOff;
        const saved = await saveOneOff(id, {
          ...rest,
          line_item_id: d.line_item_id,
          category_id: item?.category_id ?? d.category_id,
        });
        onOneOffSaved(id, saved);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSavingId(null);
    }
  }

  // Only charges and entries that add to totals count toward the sum shown
  const counted = rows.filter((r) => r.kind === "manual" || countsOnItsOwn(r.tx));
  const total = sumMoney(counted.map(rowAmount));

  return (
    <div className="space-y-3">
      <FormError>{error}</FormError>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="hidden h-10 w-24 px-3 sm:table-cell">Date</TableHead>
            <TableHead className="h-10 px-3">Description</TableHead>
            <TableHead className="hidden h-10 w-60 px-3 sm:table-cell">Line item</TableHead>
            <TableHead className="hidden h-10 px-3 text-right sm:table-cell">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const id = rowId(row);
            const month = rowMonth(row);
            const amount = rowAmount(row);
            const notCounted = row.kind === "card" && !countsOnItsOwn(row.tx);
            const { icon: Icon, label } =
              row.kind === "card"
                ? { icon: CreditCard, label: "Card charge" }
                : row.oneOff.recurring_id
                  ? { icon: Repeat, label: "Recurring" }
                  : { icon: PenLine, label: "Manual entry" };
            const name = row.kind === "card" ? row.tx.merchant || row.tx.description : row.oneOff.name;
            const detail =
              row.kind === "card"
                ? [row.tx.card_member, row.tx.source_category ?? row.tx.description].filter(Boolean).join(" · ")
                : [label, row.oneOff.note].filter(Boolean).join(" · ");
            const day = row.kind === "card" ? formatDay(row.tx.posted_on) : null;
            const monthLink = showMonth && (
              <Link to={`/month/${monthSlug(month)}`} className="text-[var(--color-primary)] hover:underline">
                {formatMonth(month, "short")}
              </Link>
            );
            const picker = (className: string) => (
              <DestinationSelect
                value={
                  row.kind === "card"
                    ? destinationValue(row.tx)
                    : destinationValue({ ...row.oneOff, one_off_id: null, excluded: false })
                }
                onChange={(v) => save(row, v)}
                categories={categories}
                items={items}
                oneOffs={row.kind === "card" ? oneOffs.filter((o) => o.month === month) : []}
                allowExclude={row.kind === "card"}
                uncategorizedLabel={row.kind === "card" ? "Uncategorized" : "Needs a category"}
                onCreated={onCreated}
                className={className}
                aria-label={`Line item for ${name}`}
                disabled={savingId === id}
              />
            );
            return (
              <TableRow key={`${row.kind}:${id}`} className={cn(notCounted && "text-[var(--color-muted-foreground)]")}>
                <TableCell className="hidden px-3 py-2 align-top whitespace-nowrap tabular-nums sm:table-cell">
                  <span className="block">{day ?? (showMonth ? "" : "—")}</span>
                  {monthLink && <span className="block text-xs">{monthLink}</span>}
                </TableCell>
                <TableCell className="max-w-0 px-3 py-2 align-top">
                  <span className="flex items-center gap-2">
                    <Icon className={iconClass} aria-label={label} />
                    <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
                    <span className={cn("font-medium whitespace-nowrap tabular-nums sm:hidden", amount < 0 && "text-[var(--color-success)]")}>
                      {formatMoney(amount, true)}
                    </span>
                  </span>
                  <span className="block truncate pl-6 text-xs text-[var(--color-muted-foreground)]">
                    {/* On phones the date column is hidden, so the date leads the detail line */}
                    {(day || showMonth) && <span className="sm:hidden">{day ?? formatMonth(month, "short")} · </span>}
                    {detail}
                    {notCounted && " · not counted"}
                  </span>
                  <div className="mt-1.5 pl-6 sm:hidden">{picker("h-10 w-full")}</div>
                </TableCell>
                <TableCell className="hidden px-3 py-2 align-top sm:table-cell">{picker("h-9 w-full")}</TableCell>
                <TableCell
                  className={cn(
                    "hidden px-3 py-2 text-right align-top font-medium whitespace-nowrap tabular-nums sm:table-cell",
                    amount < 0 && "text-[var(--color-success)]"
                  )}
                >
                  {formatMoney(amount, true)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
        <TableFooter>
          <TableRow className="hover:bg-transparent">
            <TableCell className="hidden px-3 py-2 sm:table-cell" />
            <TableCell className="px-3 py-2">
              <span className="float-right tabular-nums sm:hidden">{formatMoney(total, true)}</span>
              {rows.length} {rows.length === 1 ? "result" : "results"}
              {counted.length < rows.length && (
                <span className="font-normal text-[var(--color-muted-foreground)]"> · total excludes uncounted charges</span>
              )}
            </TableCell>
            <TableCell className="hidden px-3 py-2 sm:table-cell" />
            <TableCell className="hidden px-3 py-2 text-right whitespace-nowrap tabular-nums sm:table-cell">{formatMoney(total, true)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
