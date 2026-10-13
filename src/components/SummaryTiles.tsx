import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatMoney, type MonthSummary } from "@/lib/budget";
import { cn } from "@/lib/utils";

type Tile = { key: "income" | "spending" | "savings" | "net"; label: string; swatch?: string };

/** Income / Spending / Savings / Left over, with change vs a comparison period. */
export function SummaryTiles({
  current,
  previous,
  compareLabel,
  colors,
}: {
  current: Pick<MonthSummary, "income" | "spending" | "savings" | "net">;
  previous?: Pick<MonthSummary, "income" | "spending" | "savings" | "net"> | null;
  compareLabel?: string;
  colors?: { income: string; spending: string; savings: string };
}) {
  const tiles: Tile[] = [
    { key: "income", label: "Income", swatch: colors?.income },
    { key: "spending", label: "Spending", swatch: colors?.spending },
    { key: "savings", label: "Saved (401k, HSA…)", swatch: colors?.savings },
    { key: "net", label: "Left over" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {tiles.map((t) => {
        const value = current[t.key];
        const delta = previous ? value - previous[t.key] : null;
        const showDelta = delta !== null && previous && (previous.income || previous.spending || previous.savings);
        const hero = t.key === "net";
        const sub = hero ? "opacity-80" : "text-[var(--color-muted-foreground)]";
        return (
          <Card
            key={t.key}
            className={cn(
              "flex flex-col p-4 sm:p-5",
              hero && "border-transparent",
              hero && value >= 0 && "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]",
              hero && value < 0 && "bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)]"
            )}
          >
            <div className={cn("flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider", sub)}>
              {t.swatch && <span className="h-2 w-2 rounded-full" style={{ background: t.swatch }} aria-hidden />}
              {t.label}
            </div>
            <div className="mt-2 text-2xl font-extrabold tracking-tight tabular-nums sm:text-[1.75rem]">
              {formatMoney(value)}
            </div>
            {hero && value < 0 && (
              <div className="mt-1 text-xs font-semibold">Overspent this period</div>
            )}
            {showDelta && Math.round(delta) !== 0 ? (
              <div className={cn("mt-auto flex items-center gap-1 pt-2 text-xs font-medium", sub)}>
                <span
                  className={cn(
                    "inline-flex h-4 w-4 items-center justify-center rounded-full",
                    hero ? "bg-current/15" : "bg-[var(--color-muted)]"
                  )}
                >
                  {delta > 0 ? (
                    <ArrowUpRight className="h-3 w-3" aria-label="up" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3" aria-label="down" />
                  )}
                </span>
                {formatMoney(Math.abs(delta))} {compareLabel}
              </div>
            ) : showDelta ? (
              <div className={cn("mt-auto pt-2 text-xs font-medium", sub)}>No change {compareLabel}</div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
