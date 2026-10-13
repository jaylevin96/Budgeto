import { Pencil } from "lucide-react";
import { formatMoney, formatMonth, oneOffTarget, type Category, type LineItem, type OneOff } from "@/lib/budget";

/** Rows of one-offs; clicking a row edits it. */
export function OneOffList({
  oneOffs,
  categories,
  items,
  onEdit,
  showMonth = false,
  showTarget = true,
}: {
  oneOffs: OneOff[];
  categories: Category[];
  items: LineItem[];
  onEdit: (o: OneOff) => void;
  showMonth?: boolean;
  showTarget?: boolean;
}) {
  return (
    <ul className="divide-y divide-[var(--color-border)]">
      {oneOffs.map((o) => (
        <li key={o.id}>
          <button
            type="button"
            onClick={() => onEdit(o)}
            className="group flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--color-accent)]"
            aria-label={`Edit ${o.name}`}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{o.name}</span>
              <span className="block truncate text-xs text-[var(--color-muted-foreground)]">
                {[showMonth && formatMonth(o.month, "short"), showTarget && oneOffTarget(o, categories, items), o.note]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <span className="font-medium tabular-nums">{formatMoney(o.amount, true)}</span>
            <Pencil className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)] opacity-0 group-hover:opacity-100" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}
