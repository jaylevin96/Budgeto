import { useState } from "react";
import { CalendarDays, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PeriodPicker } from "@/components/PeriodPicker";
import {
  BUDGET_FROM_START,
  budgetChangeFor,
  budgetFor,
  budgetStartLabel,
  deleteBudgetChange,
  formatMoney,
  formatMonth,
  parseAmount,
  saveBudgetChange,
  type Category,
} from "@/lib/budget";
import { cn } from "@/lib/utils";

/**
 * A category's monthly budget over time. Each change applies from its start month until the
 * next change, so changing the budget never rewrites earlier months.
 */
export function BudgetDialog({
  category,
  month,
  onClose,
  onChanged,
}: {
  category: Category;
  /** The month the new change starts from by default (the one being looked at) */
  month: string;
  onClose: () => void;
  /** Called after any save or delete; the caller reloads */
  onChanged: () => void;
}) {
  const current = budgetFor(category, month);
  const [amountText, setAmountText] = useState(current != null ? String(current) : "");
  const [start, setStart] = useState(month);
  const [allMonths, setAllMonths] = useState(category.budgets.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startMonth = allMonths ? BUDGET_FROM_START : start;
  const later = category.budgets.filter((b) => b.start_month > startMonth);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseAmount(amountText);
    if (Number.isNaN(amount)) return setError("Budget must be a number like 600 or 75.50");
    setBusy(true);
    setError(null);
    try {
      await saveBudgetChange(category.id, startMonth, amount);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the budget");
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    setError(null);
    try {
      await deleteBudgetChange(id);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove that change");
      setBusy(false);
    }
  }

  const history = [...category.budgets].reverse();
  const inEffectId = budgetChangeFor(category, month)?.id;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{category.name} budget</DialogTitle>
          <DialogDescription>
            A change applies from its start month until the next change. Earlier months keep the budget they had.
          </DialogDescription>
        </DialogHeader>

        {history.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-sm font-semibold">History</p>
            <ul className="divide-y divide-[var(--color-border)] rounded-xl border border-[var(--color-border)]">
              {history.map((b) => {
                const inEffect = b.id === inEffectId;
                return (
                  <li key={b.id} className="flex items-center gap-3 py-1 pr-1 pl-3 text-sm">
                    <span className={cn("font-medium tabular-nums", b.amount == null && "text-[var(--color-muted-foreground)]")}>
                      {b.amount == null ? "No budget" : `${formatMoney(b.amount)}/mo`}
                    </span>
                    <span className="flex-1 text-[var(--color-muted-foreground)]">
                      {budgetStartLabel(b.start_month)}
                      {inEffect && <span className="ml-2 text-xs font-semibold text-[var(--color-primary)]">in effect</span>}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove the change ${budgetStartLabel(b.start_month)}`}
                      disabled={busy}
                      onClick={() => handleDelete(b.id)}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm font-semibold">{history.length ? "Change the budget" : "Set a budget"}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="budget-amount">Monthly budget</Label>
              <Input
                id="budget-amount"
                inputMode="decimal"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                placeholder="No budget"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Starting</Label>
              <PeriodPicker mode="month" value={start} onSelect={setStart}>
                <Button type="button" variant="outline" className="w-full justify-start" disabled={allMonths}>
                  <CalendarDays /> {formatMonth(start)}
                </Button>
              </PeriodPicker>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={allMonths} onChange={(e) => setAllMonths(e.target.checked)} />
            From the start (every earlier month too)
          </label>
          {later.length > 0 && (
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Applies until the next change ({budgetStartLabel(later[0].start_month)}).
            </p>
          )}
          <FormError>{error}</FormError>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
