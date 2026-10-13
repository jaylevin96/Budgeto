import { CreditCard, PenLine, Repeat } from "lucide-react";
import { formatMoney, formatMonth, oneOffTarget, sumMoney, type Category, type LineItem, type OneOff } from "@/lib/budget";
import type { Transaction } from "@/lib/transactions";
import { cn } from "@/lib/utils";

const rowClass = "flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-[var(--color-accent)]";
const iconClass = "h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]";

/** Rows of manual entries (pencil icon); clicking a row edits it. */
export function OneOffList({
  oneOffs,
  categories,
  items,
  onEdit,
  showMonth = false,
  showTarget = true,
  className,
}: {
  oneOffs: OneOff[];
  categories: Category[];
  items: LineItem[];
  onEdit: (o: OneOff) => void;
  showMonth?: boolean;
  showTarget?: boolean;
  className?: string;
}) {
  return (
    <ul className={cn("divide-y divide-[var(--color-border)]", className)}>
      {oneOffs.map((o) => (
        <li key={o.id}>
          <button type="button" onClick={() => onEdit(o)} className={rowClass} aria-label={`Edit manual entry ${o.name}`}>
            <PenLine className={iconClass} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 truncate font-medium">
                {o.name}
                {o.recurring_id && <Repeat className="h-3 w-3 shrink-0 text-[var(--color-muted-foreground)]" aria-label="Recurring" />}
              </span>
              {(showMonth || showTarget || o.note) && (
                <span className="block truncate text-xs text-[var(--color-muted-foreground)]">
                  {[showMonth && formatMonth(o.month, "short"), showTarget && oneOffTarget(o, categories, items), o.note]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
            </span>
            <span className="font-medium tabular-nums">{formatMoney(o.amount, true)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** One row summing card charges (card icon); clicking opens them. */
export function CardChargesRow({ charges, onClick }: { charges: Transaction[]; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={rowClass}>
      <CreditCard className={iconClass} aria-hidden />
      <span className="min-w-0 flex-1 truncate font-medium">
        Amex · {charges.length} {charges.length === 1 ? "charge" : "charges"}
      </span>
      <span className="font-medium tabular-nums">{formatMoney(sumMoney(charges.map((t) => t.amount)), true)}</span>
    </button>
  );
}
