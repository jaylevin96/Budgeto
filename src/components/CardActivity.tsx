import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ChevronDown, ChevronRight, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatMoney, formatMonth, sumMoney, type Category, type LineItem, type OneOff } from "@/lib/budget";
import { useChartColors } from "@/lib/chartColors";
import { countsOnItsOwn, formatDay, type Transaction } from "@/lib/transactions";
import { cn } from "@/lib/utils";

type OpenCharges = (title: string, description: string, charges: Transaction[]) => void;

/** "JILLIAN MIZRAJI" → "Jillian" */
const firstName = (member: string | null) => {
  const first = (member ?? "").trim().split(/\s+/)[0] ?? "";
  return first ? first[0] + first.slice(1).toLowerCase() : "Card";
};

/** Where a charge ended up, as a short label for lists */
function destinationLabel(
  t: Transaction,
  catById: Map<string, Category>,
  itemById: Map<string, LineItem>,
  oneOffById: Map<string, OneOff>
): { text: string; tone: "filed" | "unfiled" | "muted" } {
  if (t.excluded) return { text: "Not counted", tone: "muted" };
  if (t.one_off_id) return { text: `Entry: ${oneOffById.get(t.one_off_id)?.name ?? "another month"}`, tone: "muted" };
  const item = t.line_item_id ? itemById.get(t.line_item_id) : undefined;
  if (item) return { text: `${catById.get(item.category_id)?.name ?? ""} › ${item.name}`, tone: "filed" };
  const cat = t.category_id ? catById.get(t.category_id) : undefined;
  if (cat) return { text: cat.name, tone: "filed" };
  return { text: "Uncategorized", tone: "unfiled" };
}

const MAX_BARS = 6;

/**
 * The month's Amex activity at a glance: what the card added to the budget, who spent it,
 * which categories it went to, what still needs filing, and every charge on request.
 */
export function CardActivity({
  month,
  transactions,
  categories,
  items,
  oneOffs,
  onOpenCharges,
}: {
  month: string;
  /** All loaded transactions (any month); this filters to `month` */
  transactions: Transaction[];
  categories: Category[];
  items: LineItem[];
  oneOffs: OneOff[];
  onOpenCharges: OpenCharges;
}) {
  const colors = useChartColors();
  const [showAll, setShowAll] = useState(false);
  const [member, setMember] = useState<string | null>(null);

  const monthTx = transactions.filter((t) => t.month === month);
  if (!monthTx.length) {
    return (
      <Card className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
        <CreditCard className="h-4 w-4 text-[var(--color-muted-foreground)]" aria-hidden />
        <span className="flex-1 text-[var(--color-muted-foreground)]">No Amex charges for {formatMonth(month)} yet.</span>
        <Button asChild variant="ghost" size="sm">
          <Link to="/import/card">Import statement</Link>
        </Button>
      </Card>
    );
  }

  const catById = new Map(categories.map((c) => [c.id, c]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const oneOffById = new Map(oneOffs.map((o) => [o.id, o]));

  const counted = monthTx.filter(countsOnItsOwn);
  const notCounted = monthTx.filter((t) => !countsOnItsOwn(t));
  const total = sumMoney(counted.map((t) => t.amount));
  const credits = sumMoney(counted.filter((t) => t.amount < 0).map((t) => t.amount));
  const unfiled = counted.filter((t) => !t.line_item_id && !t.category_id);

  // Who spent it (counted charges, net of credits)
  const members = [...new Set(monthTx.map((t) => t.card_member ?? ""))].filter(Boolean).sort();
  const byMember = members.map((m) => ({
    member: m,
    total: sumMoney(counted.filter((t) => t.card_member === m).map((t) => t.amount)),
  }));

  // Where it went: counted charges by category; small ones fold into "Other", but
  // Uncategorized always keeps its own bar so it stays visible until it's filed
  const groups = new Map<string, Transaction[]>();
  for (const t of counted) {
    const catId = (t.line_item_id ? itemById.get(t.line_item_id)?.category_id : t.category_id) ?? "";
    groups.set(catId, [...(groups.get(catId) ?? []), t]);
  }
  const ranked = [...groups]
    .map(([catId, list]) => ({
      key: catId || "uncategorized",
      name: catId ? catById.get(catId)?.name ?? "Uncategorized" : "Uncategorized",
      list,
      total: sumMoney(list.map((t) => t.amount)),
    }))
    .sort((a, b) => b.total - a.total);
  const uncat = ranked.filter((r) => r.key === "uncategorized");
  const named = ranked.filter((r) => r.key !== "uncategorized");
  const room = MAX_BARS - uncat.length;
  const bars = [
    ...(named.length > room
      ? [
          ...named.slice(0, room - 1),
          {
            key: "other",
            name: `Other (${named.length - room + 1} categories)`,
            list: named.slice(room - 1).flatMap((r) => r.list),
            total: sumMoney(named.slice(room - 1).map((r) => r.total)),
          },
        ]
      : named),
    ...uncat,
  ];
  const maxBar = Math.max(...bars.map((b) => b.total), 0);

  // Every charge, newest day first, optionally for one card member
  const listed = monthTx
    .filter((t) => !member || t.card_member === member)
    .sort((a, b) => b.posted_on.localeCompare(a.posted_on) || b.amount - a.amount);
  const days = new Map<string, Transaction[]>();
  for (const t of listed) days.set(t.posted_on, [...(days.get(t.posted_on) ?? []), t]);

  const open = (title: string, list: Transaction[]) =>
    onOpenCharges(title, "Move any charge that belongs somewhere else; changes save right away.", list);

  return (
    <Card className="@container">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-border)] px-4 py-3">
        <h2 className="flex flex-1 items-center gap-2 font-semibold">
          <CreditCard className="h-4 w-4" aria-hidden /> Amex activity
        </h2>
        <Button asChild variant="ghost" size="sm">
          <Link to="/import/card">Import statement</Link>
        </Button>
      </div>

      {/* Sized to the card, not the screen: it sits in a narrow side column on wide month pages */}
      <div className="grid gap-4 p-4 @xl:grid-cols-[minmax(0,14rem)_1fr]">
        {/* Headline: what the card added to this month's budget */}
        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Added to {formatMonth(month, "short")}
            </p>
            <p className="text-3xl font-bold tracking-tight tabular-nums">{formatMoney(total)}</p>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              {counted.length} {counted.length === 1 ? "charge" : "charges"}
              {credits < 0 && ` · ${formatMoney(credits, true)} in credits`}
            </p>
          </div>
          {byMember.length > 1 && (
            <ul className="space-y-1 text-sm">
              {byMember.map((m) => (
                <li key={m.member} className="flex justify-between gap-3">
                  <span className="text-[var(--color-muted-foreground)]">{firstName(m.member)}</span>
                  <span className="tabular-nums">{formatMoney(m.total, true)}</span>
                </li>
              ))}
            </ul>
          )}
          {notCounted.length > 0 && (
            <button
              type="button"
              className="text-left text-xs text-[var(--color-muted-foreground)] hover:underline"
              onClick={() => open(`Not counted separately · ${formatMonth(month)}`, notCounted)}
            >
              {formatMoney(sumMoney(notCounted.map((t) => t.amount)), true)} not counted ({notCounted.length}): card
              payments, “don't count”, or already added as manual entries
            </button>
          )}
        </div>

        {/* Where it went, by category (one series → one hue; values in text ink) */}
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
            Where it went
          </p>
          <ul className="space-y-1">
            {bars.map((b) => (
              <li key={b.key}>
                <button
                  type="button"
                  onClick={() => open(`${b.name} · Amex · ${formatMonth(month)}`, b.list)}
                  className="group grid w-full grid-cols-[minmax(6rem,9rem)_1fr_4.5rem] items-center gap-3 rounded-md px-1 py-1 text-left text-sm hover:bg-[var(--color-accent)]"
                  title={`${b.name}: ${formatMoney(b.total, true)} from ${b.list.length} ${b.list.length === 1 ? "charge" : "charges"}`}
                >
                  <span className={cn("truncate", b.key === "uncategorized" && "text-[var(--color-warning)]")}>
                    {b.name}
                  </span>
                  <span className="h-2.5 overflow-hidden rounded-r-[4px] bg-[var(--color-muted)]" aria-hidden>
                    <span
                      className="block h-full rounded-r-[4px]"
                      style={{
                        width: `${maxBar > 0 ? Math.max(0, (b.total / maxBar) * 100) : 0}%`,
                        background: colors.spending,
                      }}
                    />
                  </span>
                  <span className="text-right tabular-nums">{formatMoney(b.total)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {unfiled.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] bg-[var(--color-muted)]/40 px-4 py-2.5 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--color-warning)]" aria-hidden />
          <span className="min-w-0 flex-1">
            {unfiled.length} {unfiled.length === 1 ? "charge needs" : "charges need"} a line item (
            {formatMoney(sumMoney(unfiled.map((t) => t.amount)), true)}, counted as uncategorized for now)
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onOpenCharges(
                `Unfiled card charges · ${formatMonth(month)}`,
                "Pick a line item for each. If you already added a purchase as an entry, link it so it isn't counted twice. Choose “Don't count” for anything that isn't household spending.",
                unfiled
              )
            }
          >
            Review
          </Button>
        </div>
      )}

      <div className="border-t border-[var(--color-border)]">
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          aria-expanded={showAll}
          className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium hover:bg-[var(--color-accent)]"
        >
          {showAll ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
          {showAll ? "Hide charges" : `Show all ${monthTx.length} charges`}
        </button>
        {showAll && (
          <div className="pb-2">
            {members.length > 1 && (
              <div className="flex flex-wrap gap-1.5 px-4 pb-2" role="group" aria-label="Filter by card member">
                {[null, ...members].map((m) => (
                  <button
                    key={m ?? "all"}
                    type="button"
                    aria-pressed={member === m}
                    onClick={() => setMember(m)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium",
                      member === m
                        ? "border-transparent bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                        : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                    )}
                  >
                    {m ? firstName(m) : "Everyone"}
                  </button>
                ))}
              </div>
            )}
            {[...days].map(([day, list]) => (
              <div key={day}>
                <p className="bg-[var(--color-muted)]/40 px-4 py-1 text-xs font-medium text-[var(--color-muted-foreground)]">
                  {new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                </p>
                <ul>
                  {list.map((t) => {
                    const dest = destinationLabel(t, catById, itemById, oneOffById);
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => open(`${t.merchant} · ${formatDay(t.posted_on)}`, [t])}
                          className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-[var(--color-accent)]"
                        >
                          <span className="min-w-0 flex-1">
                            <span className={cn("block truncate font-medium", !countsOnItsOwn(t) && "text-[var(--color-muted-foreground)]")}>
                              {t.merchant}
                            </span>
                            <span
                              className={cn(
                                "block truncate text-xs",
                                dest.tone === "unfiled" ? "text-[var(--color-warning)]" : "text-[var(--color-muted-foreground)]"
                              )}
                            >
                              {members.length > 1 && `${firstName(t.card_member)} · `}
                              {dest.text}
                            </span>
                          </span>
                          <span
                            className={cn(
                              "tabular-nums",
                              !countsOnItsOwn(t) && "text-[var(--color-muted-foreground)] line-through",
                              countsOnItsOwn(t) && t.amount < 0 && "text-[var(--color-success)]"
                            )}
                          >
                            {formatMoney(t.amount, true)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
