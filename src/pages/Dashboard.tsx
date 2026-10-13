import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-message";
import { Select } from "@/components/ui/select";
import { EmptyBudget } from "@/components/EmptyBudget";
import { StepperNav } from "@/components/StepperNav";
import { SummaryTiles } from "@/components/SummaryTiles";
import { useBudget } from "@/hooks/useBudget";
import { useChartColors, type ChartColors } from "@/lib/chartColors";
import {
  addMonths,
  currentMonthKey,
  formatMoney,
  formatMoneyCompact,
  formatMonth,
  indexAmounts,
  monthKey,
  monthSlug,
  MONTH_LONG,
  MONTH_SHORT,
  parseMonthKey,
  summarizeMonth,
  sumMoney,
  totalForCategoryMonth,
  type MonthSummary,
} from "@/lib/budget";
import { cn } from "@/lib/utils";

const MAX_CATEGORY_SERIES = 7; // 8th slot is "Other"

export function Dashboard() {
  const colors = useChartColors();
  const [searchParams, setSearchParams] = useSearchParams();
  const thisMonth = currentMonthKey();
  const year = Number(searchParams.get("year")) || parseMonthKey(thisMonth).year;

  const { categories, items, amounts, loading, error, reload } = useBudget(
    monthKey(year - 1, 0),
    monthKey(year + 1, 0)
  );
  const idx = useMemo(() => indexAmounts(amounts), [amounts]);
  const [breakdownScope, setBreakdownScope] = useState<"month" | "year">("month");

  const months = Array.from({ length: 12 }, (_, m) => monthKey(year, m));
  const summaries = months.map((m) => summarizeMonth(m, categories, items, idx));
  const lastWithData = [...summaries].reverse().find((s) => s.entered > 0)?.month ?? null;
  const shownMonths = lastWithData ? months.filter((m) => m <= lastWithData) : months;

  const monthParam = searchParams.get("month");
  const defaultMonth =
    lastWithData ?? (parseMonthKey(thisMonth).year === year ? thisMonth : monthKey(year, 11));
  const selectedMonth =
    monthParam && /^\d{1,2}$/.test(monthParam) && +monthParam >= 1 && +monthParam <= 12
      ? monthKey(year, +monthParam - 1)
      : defaultMonth;
  const selectedIdx = parseMonthKey(selectedMonth).month;

  const current = summaries[selectedIdx];
  const previous = summarizeMonth(addMonths(selectedMonth, -1), categories, items, idx);

  // Year to date through the selected month, vs the same months last year
  const ytd = sumSummaries(summaries.slice(0, selectedIdx + 1));
  const lastYearSummaries = Array.from({ length: selectedIdx + 1 }, (_, m) =>
    summarizeMonth(monthKey(year - 1, m), categories, items, idx)
  );
  const lastYtd = lastYearSummaries.some((s) => s.entered > 0) ? sumSummaries(lastYearSummaries) : null;

  const expenseCats = categories.filter((c) => c.kind === "expense");
  const catYearTotals = expenseCats
    .map((c) => ({ cat: c, total: sumMoney(shownMonths.map((m) => totalForCategoryMonth(c.id, m, items, idx))) }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);
  // Color follows the category, not its rank: assign slots by the category's sort order
  const seriesCats = catYearTotals.slice(0, MAX_CATEGORY_SERIES).map((c) => c.cat);
  const orderedSeries = expenseCats.filter((c) => seriesCats.includes(c));
  const hasOther = catYearTotals.length > MAX_CATEGORY_SERIES;

  const monthlyData = shownMonths.map((m, i) => ({
    label: MONTH_SHORT[parseMonthKey(m).month],
    month: m,
    Income: summaries[i].income,
    Spending: summaries[i].spending,
    Saved: summaries[i].savings,
    "Left over": summaries[i].net,
  }));

  const stackedData = shownMonths.map((m) => {
    const row: Record<string, number | string> = { label: MONTH_SHORT[parseMonthKey(m).month], month: m };
    let other = 0;
    for (const c of expenseCats) {
      const v = totalForCategoryMonth(c.id, m, items, idx);
      if (orderedSeries.includes(c)) row[c.name] = v;
      else other += v;
    }
    if (hasOther) row.Other = Math.round(other * 100) / 100;
    return row;
  });

  const breakdownMonths = breakdownScope === "month" ? [selectedMonth] : months.slice(0, selectedIdx + 1);
  const breakdown = expenseCats
    .map((c) => ({
      name: c.name,
      total: sumMoney(breakdownMonths.map((m) => totalForCategoryMonth(c.id, m, items, idx))),
    }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);

  // Biggest line-item moves vs the previous month
  const prevMonth = addMonths(selectedMonth, -1);
  const kindByCat = new Map(categories.map((c) => [c.id, c.kind]));
  const changes = items
    .filter((i) => kindByCat.get(i.category_id) === "expense")
    .map((i) => {
      const now = idx.get(i.id)?.get(selectedMonth);
      const before = idx.get(i.id)?.get(prevMonth);
      return { item: i, now: now ?? 0, before: before ?? 0, delta: (now ?? 0) - (before ?? 0), known: now !== undefined };
    })
    .filter((c) => c.known && Math.abs(c.delta) >= 1)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 6);

  function setYear(y: number) {
    setSearchParams({ year: String(y) });
  }
  function setMonth(m: number) {
    setSearchParams({ year: String(year), month: String(m + 1) });
  }

  if (!loading && !error && categories.length === 0) return <EmptyBudget onSeeded={reload} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StepperNav
          label={String(year)}
          onPrev={() => setYear(year - 1)}
          onNext={() => setYear(year + 1)}
          prevLabel="Previous year"
          nextLabel="Next year"
        />
        <div className="flex items-center gap-2">
          <Select
            aria-label="Month"
            className="h-9 w-40 rounded-full"
            value={selectedIdx}
            onChange={(e) => setMonth(Number(e.target.value))}
          >
            {MONTH_LONG.map((name, i) => (
              <option key={name} value={i}>
                {name}
              </option>
            ))}
          </Select>
          <Button asChild size="sm">
            <Link to={`/month/${monthSlug(selectedMonth)}`}>
              <PencilLine /> Enter {MONTH_SHORT[selectedIdx]}
            </Link>
          </Button>
        </div>
      </div>

      {error && <FormError>{error}</FormError>}

      {loading ? (
        <p className="text-[var(--color-muted-foreground)]">Loading…</p>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-muted-foreground)]">{formatMonth(selectedMonth)}</h2>
            <SummaryTiles current={current} previous={previous} compareLabel="vs last month" colors={colors} />
            {current.entered < items.filter((i) => !i.archived).length && current.entered > 0 && (
              <p className="text-xs text-[var(--color-muted-foreground)]">
                {current.entered} of {items.filter((i) => !i.archived).length} items entered for this month.{" "}
                <Link className="underline" to={`/month/${monthSlug(selectedMonth)}`}>
                  Finish entering
                </Link>
              </p>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Year to date (Jan–{MONTH_SHORT[selectedIdx]} {year})
            </h2>
            <SummaryTiles
              current={ytd}
              previous={lastYtd}
              compareLabel={`vs same period ${year - 1}`}
              colors={colors}
            />
          </section>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Income vs spending by month</CardTitle>
              <CardDescription>"Left over" is income minus spending and savings.</CardDescription>
            </CardHeader>
            <CardContent className="h-80 px-2 sm:px-6">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthlyData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
                  <CartesianGrid vertical={false} stroke={colors.grid} />
                  <XAxis dataKey="label" tick={{ fill: colors.axis, fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis
                    tickFormatter={formatMoneyCompact}
                    tick={{ fill: colors.axis, fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                  />
                  <Tooltip content={<MoneyTooltip colors={colors} />} cursor={{ fill: colors.grid, opacity: 0.5 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={10} formatter={legendText(colors)} />
                  <Bar isAnimationActive={false} dataKey="Income" fill={colors.income} radius={[6, 6, 0, 0]} maxBarSize={22} />
                  <Bar isAnimationActive={false} dataKey="Spending" fill={colors.spending} radius={[6, 6, 0, 0]} maxBarSize={22} />
                  <Bar isAnimationActive={false} dataKey="Saved" fill={colors.savings} radius={[6, 6, 0, 0]} maxBarSize={22} />
                  <Line
                    isAnimationActive={false}
                    dataKey="Left over"
                    stroke={colors.neutral}
                    strokeWidth={2}
                    dot={{ r: 4, fill: colors.neutral, stroke: colors.surface, strokeWidth: 2 }}
                    activeDot={{ r: 5 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Spending by category</CardTitle>
                <CardDescription>Monthly spending, stacked by category (excludes savings).</CardDescription>
              </CardHeader>
              <CardContent className="h-80 px-2 sm:px-6">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stackedData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={colors.grid} />
                    <XAxis dataKey="label" tick={{ fill: colors.axis, fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis
                      tickFormatter={formatMoneyCompact}
                      tick={{ fill: colors.axis, fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                      width={48}
                    />
                    <Tooltip content={<MoneyTooltip colors={colors} showTotal />} cursor={{ fill: colors.grid, opacity: 0.5 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={10} formatter={legendText(colors)} />
                    {orderedSeries.map((c, i) => (
                      <Bar
                        isAnimationActive={false}
                        key={c.id}
                        dataKey={c.name}
                        stackId="s"
                        fill={colors.categorical[i]}
                        stroke={colors.surface}
                        strokeWidth={1}
                        maxBarSize={32}
                      />
                    ))}
                    {hasOther && (
                      <Bar isAnimationActive={false} dataKey="Other" stackId="s" fill={colors.neutral} stroke={colors.surface} strokeWidth={1} maxBarSize={32} />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
                <div className="space-y-1.5">
                  <CardTitle className="text-lg">Where the money went</CardTitle>
                  <CardDescription>
                    {breakdownScope === "month" ? formatMonth(selectedMonth) : `Jan–${MONTH_SHORT[selectedIdx]} ${year}`}
                  </CardDescription>
                </div>
                <div className="flex rounded-full bg-[var(--color-muted)] p-1 text-xs" role="group">
                  {(["month", "year"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={breakdownScope === s}
                      onClick={() => setBreakdownScope(s)}
                      className={cn(
                        "rounded-full px-3 py-1 font-semibold text-[var(--color-muted-foreground)]",
                        breakdownScope === s && "bg-[var(--color-card)] text-[var(--color-foreground)] shadow-sm"
                      )}
                    >
                      {s === "month" ? "Month" : "YTD"}
                    </button>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="px-2 sm:px-6" style={{ height: Math.max(160, breakdown.length * 34 + 24) }}>
                {breakdown.length === 0 ? (
                  <p className="p-4 text-sm text-[var(--color-muted-foreground)]">No spending entered yet.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={breakdown} layout="vertical" margin={{ top: 0, right: 64, left: 0, bottom: 0 }}>
                      <XAxis type="number" hide />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={120}
                        tick={{ fill: colors.axis, fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip content={<MoneyTooltip colors={colors} />} cursor={{ fill: colors.grid, opacity: 0.5 }} />
                      <Bar isAnimationActive={false} dataKey="total" name="Spent" fill={colors.spending} radius={[0, 6, 6, 0]} maxBarSize={20}>
                        <LabelList
                          dataKey="total"
                          position="right"
                          formatter={(v: number) => formatMoney(v)}
                          style={{ fill: colors.tooltipText, fontSize: 12 }}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Biggest changes vs {formatMonth(prevMonth, "short")}</CardTitle>
              <CardDescription>Spending line items that moved the most this month.</CardDescription>
            </CardHeader>
            <CardContent>
              {changes.length === 0 ? (
                <p className="text-sm text-[var(--color-muted-foreground)]">No changes to show.</p>
              ) : (
                <ul className="divide-y divide-[var(--color-border)]">
                  {changes.map((c) => (
                    <li key={c.item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="truncate">{c.item.name}</span>
                      <span className="flex items-center gap-3 tabular-nums">
                        <span className="text-[var(--color-muted-foreground)]">
                          {formatMoney(c.before)} → {formatMoney(c.now)}
                        </span>
                        <span className="w-20 text-right font-medium">
                          {c.delta > 0 ? "+" : "−"}
                          {formatMoney(Math.abs(c.delta))}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

/** Legend labels in text ink, not the series color; the swatch carries identity. */
function legendText(colors: ChartColors) {
  return (value: string) => <span style={{ color: colors.axis }}>{value}</span>;
}

function sumSummaries(list: MonthSummary[]) {
  return {
    income: sumMoney(list.map((s) => s.income)),
    spending: sumMoney(list.map((s) => s.spending)),
    savings: sumMoney(list.map((s) => s.savings)),
    net: sumMoney(list.map((s) => s.net)),
  };
}

function MoneyTooltip({
  active,
  payload,
  label,
  colors,
  showTotal,
}: TooltipProps<number, string> & { colors: ChartColors; showTotal?: boolean }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => typeof p.value === "number");
  const total = sumMoney(rows.map((p) => p.value as number));
  return (
    <div
      className="min-w-40 rounded-xl border px-3 py-2 text-xs shadow-lg"
      style={{ background: colors.tooltipBg, color: colors.tooltipText, borderColor: colors.grid }}
    >
      {label && <div className="mb-1 font-medium">{label}</div>}
      {[...rows].reverse().map((p) => (
        <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden />
            {p.name}
          </span>
          <span className="tabular-nums">{formatMoney(p.value as number)}</span>
        </div>
      ))}
      {showTotal && rows.length > 1 && (
        <div className="mt-1 flex justify-between border-t pt-1 font-medium" style={{ borderColor: colors.grid }}>
          <span>Total</span>
          <span className="tabular-nums">{formatMoney(total)}</span>
        </div>
      )}
    </div>
  );
}
