import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { supabase } from "@/lib/supabase";
import { parseAmount, type Category, type CategoryKind, type LineItem } from "@/lib/budget";

// Create / edit dialogs for the budget's structure, shared by Settings and the month page

export function CategoryDialog({
  category,
  nextSortOrder,
  onClose,
  onSaved,
}: {
  category: Category | null;
  nextSortOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [kind, setKind] = useState<CategoryKind>(category?.kind ?? "expense");
  const [archived, setArchived] = useState(category?.archived ?? false);
  const [budgetText, setBudgetText] = useState(category?.monthly_budget != null ? String(category.monthly_budget) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Name is required");
    const budget = parseAmount(budgetText);
    if (Number.isNaN(budget)) return setError("Budget must be a number like 600 or 75.50");
    setBusy(true);
    setError(null);
    const row = { name: name.trim(), kind, archived, monthly_budget: kind === "income" ? null : budget };
    const { error: err } = category
      ? await supabase.from("categories").update(row).eq("id", category.id)
      : await supabase.from("categories").insert({ ...row, sort_order: nextSortOrder });
    setBusy(false);
    if (err) return setError(err.code === "23505" ? "A category with that name already exists" : err.message);
    onSaved();
  }

  async function handleDelete() {
    if (!category) return;
    if (
      !window.confirm(
        `Delete "${category.name}", ALL of its line items, recurring entries and every manual entry in it? Its card charges go back to unfiled. Archive it instead to keep history.`
      )
    )
      return;
    setBusy(true);
    // Manual entries always belong to a category, so they go with it (the database would only unlink them)
    const { error: entriesErr } = await supabase.from("one_offs").delete().eq("category_id", category.id);
    if (entriesErr) {
      setBusy(false);
      return setError(entriesErr.message);
    }
    const { error: err } = await supabase.from("categories").delete().eq("id", category.id);
    setBusy(false);
    if (err) return setError(err.message);
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{category ? "Edit category" : "New category"}</DialogTitle>
          <DialogDescription>
            Savings categories (401k, HSA) are tracked separately from spending.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cat-name">Name</Label>
            <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cat-kind">Type</Label>
            <Select id="cat-kind" value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)}>
              <option value="income">Income</option>
              <option value="expense">Spending</option>
              <option value="savings">Savings</option>
            </Select>
          </div>
          {kind !== "income" && (
            <BudgetField id="cat-budget" value={budgetText} onChange={setBudgetText} />
          )}
          {category && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
              Archived (hidden from entry, history kept)
            </label>
          )}
          <FormError>{error}</FormError>
          <DialogFooter className="gap-2">
            {category && (
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

export function ItemDialog({
  item,
  categoryId,
  categories,
  nextSortOrder,
  onClose,
  onSaved,
}: {
  item: LineItem | null;
  categoryId: string;
  categories: Category[];
  nextSortOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [catId, setCatId] = useState(item?.category_id ?? categoryId);
  const [archived, setArchived] = useState(item?.archived ?? false);
  const [budgetText, setBudgetText] = useState(item?.monthly_budget != null ? String(item.monthly_budget) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Name is required");
    const budget = parseAmount(budgetText);
    if (Number.isNaN(budget)) return setError("Budget must be a number like 600 or 75.50");
    setBusy(true);
    setError(null);
    const row = {
      name: name.trim(),
      category_id: catId,
      monthly_budget: budget,
      archived,
    };
    const { error: err } = item
      ? await supabase.from("line_items").update(row).eq("id", item.id)
      : await supabase.from("line_items").insert({ ...row, sort_order: nextSortOrder });
    setBusy(false);
    if (err) return setError(err.code === "23505" ? "That category already has an item with this name" : err.message);
    onSaved();
  }

  async function handleDelete() {
    if (!item) return;
    if (!window.confirm(`Delete "${item.name}"? Its manual entries stay in the category (under Other); its card charges go back to unfiled. Archive it instead to keep history.`)) return;
    setBusy(true);
    const { error: err } = await supabase.from("line_items").delete().eq("id", item.id);
    setBusy(false);
    if (err) return setError(err.message);
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? "Edit line item" : "New line item"}</DialogTitle>
          <DialogDescription>
            A line within the category (Rent, Groceries). Manual entries and card charges can be filed to it.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="item-name">Name</Label>
            <Input id="item-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="item-cat">Category</Label>
            <Select id="item-cat" value={catId} onChange={(e) => setCatId(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <BudgetField id="item-budget" value={budgetText} onChange={setBudgetText} />
          {item && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
              Archived (hidden from entry, history kept)
            </label>
          )}
          <FormError>{error}</FormError>
          <DialogFooter className="gap-2">
            {item && (
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

function BudgetField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        Monthly budget <span className="font-normal">(optional)</span>
      </Label>
      <Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="No budget" />
    </div>
  );
}
