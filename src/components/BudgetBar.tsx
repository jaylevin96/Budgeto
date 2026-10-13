import { AlertTriangle } from "lucide-react";
import { budgetStatus, formatMoney } from "@/lib/budget";
import { cn } from "@/lib/utils";

/** "$spent of $budget" with a progress bar; turns amber at 90% and red (with an icon) over budget. */
export function BudgetBar({ spent, budget, className }: { spent: number; budget: number; className?: string }) {
  const { pct, tone, label } = budgetStatus(spent, budget);
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-[var(--color-muted-foreground)] tabular-nums">
          {formatMoney(spent)} of {formatMoney(budget)}
        </span>
        <span
          className={cn(
            "flex items-center gap-1 font-medium tabular-nums",
            tone === "over" && "text-[var(--color-destructive)]",
            tone === "near" && "text-[var(--color-warning)]",
            tone === "ok" && "text-[var(--color-muted-foreground)]"
          )}
        >
          {tone === "over" && <AlertTriangle className="h-3 w-3" aria-hidden />}
          {label}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-[var(--color-muted)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.round(pct * 100))}
        aria-label={`${Math.round(pct * 100)}% of budget used`}
      >
        <div
          className={cn(
            "h-full rounded-full",
            tone === "over" && "bg-[var(--color-destructive)]",
            tone === "near" && "bg-[var(--color-warning)]",
            tone === "ok" && "bg-[var(--color-success)]"
          )}
          style={{ width: `${Math.min(100, pct * 100)}%` }}
        />
      </div>
    </div>
  );
}
