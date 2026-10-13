import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatMoney, type MonthSummary } from "@/lib/budget";

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
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((t) => {
        const value = current[t.key];
        const delta = previous ? value - previous[t.key] : null;
        const showDelta = delta !== null && previous && (previous.income || previous.spending || previous.savings);
        return (
          <Card key={t.key} className="p-4">
            <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-muted-foreground)]">
              {t.swatch && <span className="h-2.5 w-2.5 rounded-sm" style={{ background: t.swatch }} aria-hidden />}
              {t.label}
            </div>
            <div
              className={
                "mt-1 text-xl font-semibold tabular-nums sm:text-2xl" +
                (t.key === "net" && value < 0 ? " text-[var(--color-destructive)]" : "")
              }
            >
              {formatMoney(value)}
            </div>
            {showDelta && Math.round(delta) !== 0 ? (
              <div className="mt-1 flex items-center gap-0.5 text-xs text-[var(--color-muted-foreground)]">
                {delta > 0 ? (
                  <ArrowUpRight className="h-3 w-3" aria-label="up" />
                ) : (
                  <ArrowDownRight className="h-3 w-3" aria-label="down" />
                )}
                {formatMoney(Math.abs(delta))} {compareLabel}
              </div>
            ) : showDelta ? (
              <div className="mt-1 text-xs text-[var(--color-muted-foreground)]">No change {compareLabel}</div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
