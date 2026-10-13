import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  deleteOneOff,
  MONTH_LONG,
  monthKey,
  parseAmount,
  parseMonthKey,
  saveOneOff,
  type Category,
  type LineItem,
  type OneOff,
} from "@/lib/budget";

/** Add or edit a manual entry (a one_offs row). `onSaved(id, null)` means it was deleted. */
export function OneOffDialog({
  oneOff,
  defaults,
  categories,
  items,
  onClose,
  onSaved,
}: {
  oneOff: OneOff | null;
  defaults: { month: string; category_id?: string | null; line_item_id?: string | null };
  categories: Category[];
  items: LineItem[];
  onClose: () => void;
  onSaved: (id: string, saved: OneOff | null) => void;
}) {
  const initialMonth = parseMonthKey(oneOff?.month ?? defaults.month);
  const [name, setName] = useState(oneOff?.name ?? "");
  const [amountText, setAmountText] = useState(oneOff ? String(oneOff.amount) : "");
  const [monthIdx, setMonthIdx] = useState(initialMonth.month);
  const [yearText, setYearText] = useState(String(initialMonth.year));
  const [categoryId, setCategoryId] = useState(oneOff?.category_id ?? defaults.category_id ?? "");
  const [lineItemId, setLineItemId] = useState(oneOff?.line_item_id ?? defaults.line_item_id ?? "");
  const [note, setNote] = useState(oneOff?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeCategories = categories.filter((c) => !c.archived || c.id === categoryId);
  const categoryItems = items.filter(
    (i) => i.category_id === categoryId && (!i.archived || i.id === lineItemId)
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give it a name, e.g. Hotel");
    const amount = parseAmount(amountText);
    if (amount === null || Number.isNaN(amount)) return setError("Enter an amount like 400 or 399.99");
    const year = Number(yearText);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return setError("Enter a valid year");
    setBusy(true);
    setError(null);
    try {
      const saved = await saveOneOff(oneOff?.id ?? null, {
        name: name.trim(),
        amount,
        month: monthKey(year, monthIdx),
        category_id: categoryId || null,
        line_item_id: categoryId && lineItemId ? lineItemId : null,
        note: note || null,
      });
      onSaved(saved.id, saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!oneOff || !window.confirm(`Delete "${oneOff.name}"?`)) return;
    setBusy(true);
    try {
      await deleteOneOff(oneOff.id);
      onSaved(oneOff.id, null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{oneOff ? "Edit manual entry" : "New manual entry"}</DialogTitle>
          <DialogDescription>
            A named amount for one month, like “Hotel $500” or “Snorkel tour $120”. Put it in a category (and
            optionally a line item) so it rolls into that total, or leave it uncategorized.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
            <div className="space-y-2">
              <Label htmlFor="oo-name">What was it?</Label>
              <Input
                id="oo-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Hotel"
                autoFocus
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="oo-amount">Amount</Label>
              <Input
                id="oo-amount"
                inputMode="decimal"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                placeholder="0.00"
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-[1fr_6rem] gap-4">
            <div className="space-y-2">
              <Label htmlFor="oo-month">Month</Label>
              <Select id="oo-month" value={monthIdx} onChange={(e) => setMonthIdx(Number(e.target.value))}>
                {MONTH_LONG.map((m, i) => (
                  <option key={m} value={i}>
                    {m}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="oo-year">Year</Label>
              <Input id="oo-year" inputMode="numeric" value={yearText} onChange={(e) => setYearText(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="oo-cat">Category (optional)</Label>
            <Select
              id="oo-cat"
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setLineItemId("");
              }}
            >
              <option value="">None (uncategorized spending)</option>
              {activeCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          {categoryId && categoryItems.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="oo-item">Line item (optional)</Label>
              <Select id="oo-item" value={lineItemId} onChange={(e) => setLineItemId(e.target.value)}>
                <option value="">None (shows in this category’s manual entries)</option>
                {categoryItems.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="oo-note">Note (optional)</Label>
            <Input id="oo-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Spring break" />
          </div>
          <FormError>{error}</FormError>
          <DialogFooter className="gap-2">
            {oneOff && (
              <Button type="button" variant="destructive" className="sm:mr-auto" onClick={handleDelete} disabled={busy}>
                Delete
              </Button>
            )}
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
