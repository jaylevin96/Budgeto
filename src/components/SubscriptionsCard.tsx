import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, CreditCard, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMoney, formatMonth, sumMoney } from "@/lib/budget";
import { findSubscriptions, type Subscription } from "@/lib/subscriptions";
import { formatDay, type Transaction } from "@/lib/transactions";
import { cn } from "@/lib/utils";

const HIDDEN_KEY = "budgeto:hidden-subscriptions";

function readHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeHidden(keys: Set<string>) {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...keys]));
  } catch {
    // Storage unavailable (private window): hiding lasts until reload
  }
}

/** "Oct 3, 2026" */
const longDay = (iso: string) => `${formatMonth(`${iso.slice(0, 7)}-01`, "short").split(" ")[0]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;

/**
 * Card charges that repeat monthly or yearly at about the same amount, as of `month`: what they
 * cost a month and a year, price increases, new ones, and ones that seem to have stopped.
 * "Not a subscription" hides one in this browser.
 */
export function SubscriptionsCard({ transactions, month }: { transactions: Transaction[]; month: string }) {
  const all = useMemo(() => findSubscriptions(transactions, month), [transactions, month]);
  const [hidden, setHidden] = useState(readHidden);
  const [showStopped, setShowStopped] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [open, setOpen] = useState<Subscription | null>(null);

  const visible = all.filter((s) => !hidden.has(s.key));
  const active = visible.filter((s) => !s.stopped);
  const stopped = visible.filter((s) => s.stopped);
  const hiddenHere = all.filter((s) => hidden.has(s.key));
  const perMonth = sumMoney(active.map((s) => s.monthlyCost));
  const perYear = sumMoney(active.map((s) => s.yearlyCost));

  const toggleHidden = (key: string) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    writeHidden(next);
    setHidden(next);
  };

  const row = (s: Subscription, muted = false) => {
    const detail = [
      s.cadence === "monthly" ? "every month" : "every year",
      s.stopped ? `last charged ${longDay(s.lastChargedOn)}` : `last ${formatDay(s.lastChargedOn)}`,
      s.cadence === "yearly" && !s.stopped && `next ~${formatMonth(`${s.nextExpectedOn.slice(0, 7)}-01`, "short")}`,
    ]
      .filter(Boolean)
      .join(" · ");
    const up = s.priceChange && s.amount > s.priceChange.from;
    return (
      <li key={s.key}>
        <button
          type="button"
          onClick={() => setOpen(s)}
          className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-[var(--color-accent)]"
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className={cn("truncate font-medium", muted && "text-[var(--color-muted-foreground)]")}>{s.merchant}</span>
              {s.isNew && <Pill tone="muted">New</Pill>}
              {s.priceChange && (
                <Pill tone={up ? "warning" : "muted"}>
                  {up ? "Up" : "Down"} {formatMoney(Math.abs(s.amount - s.priceChange.from), true)}
                </Pill>
              )}
            </span>
            <span className="block truncate text-xs text-[var(--color-muted-foreground)]">{detail}</span>
          </span>
          <span className="text-right tabular-nums">
            <span className={cn("block font-medium", muted && "text-[var(--color-muted-foreground)] line-through")}>
              {formatMoney(s.amount, true)}
            </span>
            <span className="block text-xs text-[var(--color-muted-foreground)]">
              {s.cadence === "monthly" ? `${formatMoney(s.yearlyCost)}/yr` : `${formatMoney(s.monthlyCost, true)}/mo`}
            </span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <CreditCard className="h-4 w-4" aria-hidden /> Subscriptions
        </CardTitle>
        <CardDescription>
          {active.length
            ? `${formatMoney(perMonth)} a month · ${formatMoney(perYear)} a year across ${active.length} ${
                active.length === 1 ? "subscription" : "subscriptions"
              }, found in card charges that repeat at about the same amount.`
            : "Card charges that repeat at about the same amount every month or year."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {active.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            No repeating card charges found yet. Subscriptions show up after about 3 months of Amex imports.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">{active.map((s) => row(s))}</ul>
        )}
        {stopped.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowStopped((v) => !v)}
              aria-expanded={showStopped}
              className="flex items-center gap-1 text-xs font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              {showStopped ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Stopped? ({stopped.length})
            </button>
            {showStopped && <ul className="mt-1 divide-y divide-[var(--color-border)]">{stopped.map((s) => row(s, true))}</ul>}
          </div>
        )}
        {hiddenHere.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowHidden((v) => !v)}
              aria-expanded={showHidden}
              className="flex items-center gap-1 text-xs font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              {showHidden ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Hidden as not subscriptions ({hiddenHere.length})
            </button>
            {showHidden && (
              <ul className="mt-1 divide-y divide-[var(--color-border)]">
                {hiddenHere.map((s) => (
                  <li key={s.key} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="truncate text-[var(--color-muted-foreground)]">
                      {s.merchant} · {formatMoney(s.amount, true)}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => toggleHidden(s.key)}>
                      Show again
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
      {open && (
        <SubscriptionDialog
          sub={open}
          onClose={() => setOpen(null)}
          onHide={() => {
            toggleHidden(open.key);
            setOpen(null);
          }}
        />
      )}
    </Card>
  );
}

function SubscriptionDialog({ sub, onClose, onHide }: { sub: Subscription; onClose: () => void; onHide: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{sub.merchant}</DialogTitle>
          <DialogDescription>
            {formatMoney(sub.amount, true)} {sub.cadence === "monthly" ? "a month" : "a year"} ({formatMoney(sub.yearlyCost)} a year).
            {sub.priceChange &&
              ` Was ${formatMoney(sub.priceChange.from, true)} until ${longDay(sub.priceChange.since)}.`}
            {sub.stopped && ` No charge since ${longDay(sub.lastChargedOn)}; it may have been cancelled.`}
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-80 divide-y divide-[var(--color-border)] overflow-y-auto">
          {sub.charges.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <Link to={`/month/${c.month.slice(0, 7)}`} className="hover:underline">
                {longDay(c.posted_on)}
              </Link>
              <span className="font-medium tabular-nums">{formatMoney(c.amount, true)}</span>
            </li>
          ))}
        </ul>
        <DialogFooter className="gap-2">
          <Button variant="ghost" className="sm:mr-auto" onClick={onHide}>
            <EyeOff /> Not a subscription
          </Button>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Pill({ tone, children }: { tone: "warning" | "muted"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
        tone === "warning"
          ? "bg-[var(--color-warning)]/15 text-[var(--color-warning)] ring-1 ring-[var(--color-warning)]/40"
          : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]"
      )}
    >
      {children}
    </span>
  );
}
