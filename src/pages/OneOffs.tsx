import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-message";
import { OneOffDialog } from "@/components/OneOffDialog";
import { OneOffList } from "@/components/OneOffList";
import { StepperNav } from "@/components/StepperNav";
import { useBudget } from "@/hooks/useBudget";
import { currentMonthKey, formatMoney, formatMonth, monthKey, parseMonthKey, sumMoney, type OneOff } from "@/lib/budget";

/** Every entry (named amount, typed by hand) in a year, newest month first. */
export function OneOffs() {
  const [searchParams, setSearchParams] = useSearchParams();
  const thisMonth = currentMonthKey();
  const year = Number(searchParams.get("year")) || parseMonthKey(thisMonth).year;
  const { categories, items, oneOffs, loading, error, applyOneOff } = useBudget(monthKey(year, 0), monthKey(year + 1, 0));
  const [editing, setEditing] = useState<{ oneOff: OneOff | null } | null>(null);

  const yearOneOffs = oneOffs.filter((o) => o.month.startsWith(`${year}-`));
  const byMonth = new Map<string, OneOff[]>();
  for (const o of [...yearOneOffs].sort((a, b) => b.month.localeCompare(a.month) || b.amount - a.amount)) {
    byMonth.set(o.month, [...(byMonth.get(o.month) ?? []), o]);
  }
  const defaultMonth = parseMonthKey(thisMonth).year === year ? thisMonth : monthKey(year, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StepperNav
          label={`Entries ${year}`}
          onPrev={() => setSearchParams({ year: String(year - 1) })}
          onNext={() => setSearchParams({ year: String(year + 1) })}
          prevLabel="Previous year"
          nextLabel="Next year"
        />
        <Button size="sm" onClick={() => setEditing({ oneOff: null })}>
          <Plus /> Entry
        </Button>
      </div>
      <p className="text-sm text-[var(--color-muted-foreground)]">
        Itemized spending you add by hand, like “Hotel $500” or “Snorkel tour $120”. Tied to a line item they add to
        that item's month; tied to a category they show in its entries; otherwise they count as uncategorized
        spending.
        {yearOneOffs.length > 0 && (
          <>
            {" "}
            <span className="font-medium text-[var(--color-foreground)]">
              {formatMoney(sumMoney(yearOneOffs.map((o) => o.amount)))} total in {year}.
            </span>
          </>
        )}
      </p>
      {error && <FormError>{error}</FormError>}
      {loading ? (
        <p className="text-[var(--color-muted-foreground)]">Loading…</p>
      ) : byMonth.size === 0 ? (
        <Card className="p-6 text-center text-sm text-[var(--color-muted-foreground)]">
          No entries in {year} yet.
        </Card>
      ) : (
        [...byMonth].map(([m, list]) => (
          <Card key={m}>
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
              <h2 className="font-semibold">{formatMonth(m)}</h2>
              <span className="text-sm font-medium tabular-nums">
                {formatMoney(sumMoney(list.map((o) => o.amount)), true)}
              </span>
            </div>
            <OneOffList
              oneOffs={list}
              categories={categories}
              items={items}
              onEdit={(o) => setEditing({ oneOff: o })}
            />
          </Card>
        ))
      )}
      {editing && (
        <OneOffDialog
          oneOff={editing.oneOff}
          defaults={{ month: editing.oneOff?.month ?? defaultMonth }}
          categories={categories}
          items={items}
          onClose={() => setEditing(null)}
          onSaved={(id, saved) => {
            setEditing(null);
            applyOneOff(id, saved);
          }}
        />
      )}
    </div>
  );
}
