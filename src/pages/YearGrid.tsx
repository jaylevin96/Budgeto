import { Fragment, useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-message";
import { EmptyBudget } from "@/components/EmptyBudget";
import { StepperNav } from "@/components/StepperNav";
import { useBudget } from "@/hooks/useBudget";
import { useChartColors } from "@/lib/chartColors";
import {
  currentMonthKey,
  formatMoney,
  indexAmounts,
  KIND_LABEL,
  monthKey,
  monthSlug,
  MONTH_SHORT,
  parseMonthKey,
  summarizeMonth,
  sumMoney,
} from "@/lib/budget";
import { cn } from "@/lib/utils";

const cellClass = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";
const stickyName =
  "sticky left-0 z-10 bg-[var(--color-card)] px-3 py-1.5 text-left whitespace-nowrap max-w-44 truncate";

/** The spreadsheet view: every line item × month, with category and overall totals. */
export function YearGrid() {
  const params = useParams();
  const navigate = useNavigate();
  const colors = useChartColors();
  const year = /^\d{4}$/.test(params.year ?? "") ? Number(params.year) : parseMonthKey(currentMonthKey()).year;
  const months = Array.from({ length: 12 }, (_, m) => monthKey(year, m));

  const { categories, items, amounts, loading, error, reload } = useBudget(monthKey(year, 0), monthKey(year + 1, 0));
  const idx = useMemo(() => indexAmounts(amounts), [amounts]);
  const summaries = months.map((m) => summarizeMonth(m, categories, items, idx));

  if (!loading && !error && categories.length === 0) return <EmptyBudget onSeeded={reload} />;

  const visibleCats = categories.filter(
    (c) => !c.archived || items.some((i) => i.category_id === c.id && months.some((m) => idx.get(i.id)?.has(m)))
  );

  const totalRows: { label: string; values: number[]; strong?: boolean }[] = [
    { label: "Total income", values: summaries.map((s) => s.income) },
    { label: "Total spending", values: summaries.map((s) => s.spending) },
    { label: "Total saved", values: summaries.map((s) => s.savings) },
    { label: "Left over", values: summaries.map((s) => s.net), strong: true },
  ];

  return (
    <div className="space-y-4">
      <StepperNav
        label={String(year)}
        onPrev={() => navigate(`/year/${year - 1}`)}
        onNext={() => navigate(`/year/${year + 1}`)}
        prevLabel="Previous year"
        nextLabel="Next year"
      />
      {error && <FormError>{error}</FormError>}
      {loading ? (
        <p className="text-[var(--color-muted-foreground)]">Loading…</p>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-xs text-[var(--color-muted-foreground)]">
                <th className={cn(stickyName, "font-medium")}>Item</th>
                {months.map((m, i) => (
                  <th key={m} className={cn(cellClass, "font-medium")}>
                    <Link to={`/month/${monthSlug(m)}`} className="hover:underline">
                      {MONTH_SHORT[i]}
                    </Link>
                  </th>
                ))}
                <th className={cn(cellClass, "font-semibold text-[var(--color-foreground)]")}>Year</th>
                <th className={cn(cellClass, "font-medium")}>Avg/mo</th>
                <th className="px-3 py-1.5 text-left font-medium">Trend</th>
              </tr>
            </thead>
            <tbody>
              {visibleCats.map((cat) => {
                const catItems = items.filter((i) => i.category_id === cat.id);
                const catTotals = months.map((m) => sumMoney(catItems.map((i) => idx.get(i.id)?.get(m) ?? 0)));
                const catHas = months.map((m) => catItems.some((i) => idx.get(i.id)?.has(m)));
                return (
                  <Fragment key={cat.id}>
                    <tr className="bg-[var(--color-muted)]">
                      <th
                        colSpan={16}
                        className="sticky left-0 bg-[var(--color-muted)] px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide"
                      >
                        {cat.name}
                        <span className="ml-2 font-normal normal-case tracking-normal text-[var(--color-muted-foreground)]">
                          {KIND_LABEL[cat.kind]}
                        </span>
                      </th>
                    </tr>
                    {catItems.map((item) => {
                      const vals = months.map((m) => idx.get(item.id)?.get(m));
                      const entered = vals.filter((v): v is number => v !== undefined);
                      return (
                        <tr key={item.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-accent)]">
                          <td className={cn(stickyName, item.archived && "text-[var(--color-muted-foreground)]")}>
                            {item.name}
                          </td>
                          {vals.map((v, i) => (
                            <td key={i} className={cn(cellClass, v === undefined && "text-[var(--color-muted-foreground)]")}>
                              {v === undefined ? "·" : formatMoney(v)}
                            </td>
                          ))}
                          <td className={cn(cellClass, "font-medium")}>{formatMoney(sumMoney(entered))}</td>
                          <td className={cn(cellClass, "text-[var(--color-muted-foreground)]")}>
                            {entered.length ? formatMoney(sumMoney(entered) / entered.length) : "·"}
                          </td>
                          <td className="px-3 py-1.5">
                            <Sparkline values={vals} color={colors.categorical[0]} />
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="border-b-2 border-[var(--color-border)] font-medium">
                      <td className={stickyName}>Total</td>
                      {catTotals.map((v, i) => (
                        <td key={i} className={cellClass}>
                          {catHas[i] ? formatMoney(v) : "·"}
                        </td>
                      ))}
                      <td className={cn(cellClass, "font-semibold")}>{formatMoney(sumMoney(catTotals))}</td>
                      <td className={cn(cellClass, "text-[var(--color-muted-foreground)]")}>
                        {catHas.some(Boolean)
                          ? formatMoney(sumMoney(catTotals) / catHas.filter(Boolean).length)
                          : "·"}
                      </td>
                      <td className="px-3 py-1.5">
                        <Sparkline values={catTotals.map((v, i) => (catHas[i] ? v : undefined))} color={colors.categorical[0]} />
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
              <tr className="bg-[var(--color-muted)]">
                <th
                  colSpan={16}
                  className="sticky left-0 bg-[var(--color-muted)] px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide"
                >
                  Totals
                </th>
              </tr>
              {totalRows.map((row) => {
                const has = summaries.map((s) => s.entered > 0);
                return (
                  <tr key={row.label} className={cn("border-b border-[var(--color-border)]", row.strong && "font-semibold")}>
                    <td className={stickyName}>{row.label}</td>
                    {row.values.map((v, i) => (
                      <td
                        key={i}
                        className={cn(cellClass, row.strong && v < 0 && "text-[var(--color-destructive)]")}
                      >
                        {has[i] ? formatMoney(v) : "·"}
                      </td>
                    ))}
                    <td className={cn(cellClass, "font-semibold")}>{formatMoney(sumMoney(row.values))}</td>
                    <td className={cn(cellClass, "text-[var(--color-muted-foreground)]")}>
                      {has.some(Boolean) ? formatMoney(sumMoney(row.values) / has.filter(Boolean).length) : "·"}
                    </td>
                    <td className="px-3 py-1.5">
                      <Sparkline values={row.values.map((v, i) => (has[i] ? v : undefined))} color={colors.categorical[0]} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

/** Tiny trend line like the spreadsheet's SPARKLINE column. Gaps are skipped. */
function Sparkline({ values, color }: { values: (number | undefined)[]; color: string }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== undefined);
  if (pts.length < 2) return <span className="text-[var(--color-muted-foreground)]">·</span>;
  const w = 80;
  const h = 20;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const x = (i: number) => (i / 11) * (w - 4) + 2;
  const y = (v: number) => (max === min ? h / 2 : h - 2 - ((v - min) / (max - min)) * (h - 4));
  const d = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="block">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r={2} fill={color} />
    </svg>
  );
}
