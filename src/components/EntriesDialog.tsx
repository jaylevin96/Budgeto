import { Link } from "react-router-dom";
import { CreditCard, PenLine, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMoney, formatMonth, monthSlug, sumMoney, type LedgerEntry } from "@/lib/budget";
import { formatDay } from "@/lib/transactions";
import { cn } from "@/lib/utils";

export type EntriesPeriod = { month: string; entries: LedgerEntry[] };

export const ENTRY_SOURCE = {
  card: { icon: CreditCard, label: "Card" },
  manual: { icon: PenLine, label: "Manual entry" },
  recurring: { icon: Repeat, label: "Recurring" },
} as const;

/**
 * Read-only list of the entries behind a dashboard number. One period lists a month;
 * two periods sit side by side (earlier month first) to show what changed.
 */
export function EntriesDialog({
  title,
  description,
  periods,
  showItem,
  onClose,
}: {
  title: string;
  description?: string;
  periods: EntriesPeriod[];
  /** Show which line item each entry rolls into (for category-level lists) */
  showItem?: boolean;
  onClose: () => void;
}) {
  const compare = periods.length > 1;
  const linkMonth = periods[periods.length - 1].month;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn(compare && "sm:max-w-3xl")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className={cn("grid gap-6", compare && "sm:grid-cols-2")}>
          {periods.map((p) => (
            <PeriodList key={p.month} period={p} showHeading={compare} showItem={showItem} />
          ))}
        </div>
        <DialogFooter>
          <Button asChild variant="outline" size="sm">
            <Link to={`/month/${monthSlug(linkMonth)}`}>Open {formatMonth(linkMonth, "short")}</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PeriodList({ period, showHeading, showItem }: { period: EntriesPeriod; showHeading: boolean; showItem?: boolean }) {
  const total = sumMoney(period.entries.map((e) => e.amount));
  return (
    <section className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-border)] pb-2 text-sm font-semibold">
        <span>{showHeading ? formatMonth(period.month) : `${period.entries.length} ${period.entries.length === 1 ? "entry" : "entries"}`}</span>
        <span className="tabular-nums">{formatMoney(total, true)}</span>
      </div>
      {period.entries.length === 0 ? (
        <p className="py-3 text-sm text-[var(--color-muted-foreground)]">Nothing this month.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {period.entries.map((e) => {
            const { icon: Icon, label } = ENTRY_SOURCE[e.source];
            const detail = [e.postedOn ? formatDay(e.postedOn) : label, showItem && e.itemName].filter(Boolean).join(" · ");
            return (
              <li key={e.id} className="flex items-center gap-3 py-2 text-sm">
                <Icon className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" aria-label={label} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{e.name}</span>
                  <span className="block truncate text-xs text-[var(--color-muted-foreground)]">{detail}</span>
                </span>
                <span className="font-medium tabular-nums">{formatMoney(e.amount, true)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
