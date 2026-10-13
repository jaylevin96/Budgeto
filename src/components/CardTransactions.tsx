import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  createLineItem,
  formatMoney,
  type Category,
  type CreatedStructure,
  type LineItem,
  type OneOff,
} from "@/lib/budget";
import {
  destinationValue,
  EXCLUDE,
  formatDay,
  parseDestination,
  saveMerchantRules,
  updateTransactions,
  type Transaction,
} from "@/lib/transactions";
import { cn } from "@/lib/utils";

const NEW_ITEM = "__new";

/**
 * Where a card charge goes: a line item, one of the month's one-offs ("already entered"),
 * uncategorized, or "don't count". With `onCreated`, it also offers "+ New line item…",
 * which creates the line item (and, optionally, a new category) and then picks it.
 */
export function DestinationSelect({
  value,
  onChange,
  categories,
  items,
  oneOffs,
  onCreated,
  className,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
  categories: Category[];
  items: LineItem[];
  /** One-offs the charge could be covered by (same month) */
  oneOffs: OneOff[];
  onCreated?: (created: CreatedStructure) => void;
  className?: string;
  "aria-label"?: string;
  disabled?: boolean;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <Select
        value={value}
        onChange={(e) => (e.target.value === NEW_ITEM ? setCreating(true) : onChange(e.target.value))}
        className={cn("h-9", !value && "border-[var(--color-warning)]", className)}
        {...props}
      >
        <option value="">Uncategorized</option>
        {categories
          .filter((c) => !c.archived)
          .map((c) => (
            <optgroup key={c.id} label={c.name}>
              {items
                .filter((i) => i.category_id === c.id && (!i.archived || i.id === value))
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
            </optgroup>
          ))}
        {oneOffs.length > 0 && (
          <optgroup label="Already entered as a one-off">
            {oneOffs.map((o) => (
              <option key={o.id} value={destinationValue({ line_item_id: null, one_off_id: o.id, excluded: false })}>
                {o.name} ({formatMoney(o.amount)})
              </option>
            ))}
          </optgroup>
        )}
        {onCreated && <option value={NEW_ITEM}>+ New line item…</option>}
        <option value={EXCLUDE}>Don't count</option>
      </Select>
      {creating && onCreated && (
        <NewLineItemDialog
          categories={categories}
          items={items}
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            onCreated(created);
            onChange(created.item.id);
          }}
        />
      )}
    </>
  );
}

const NEW_CATEGORY = "__new_category";

/** Name a new spending line item and pick its category, or name a new category for it. */
function NewLineItemDialog({
  categories,
  items,
  onClose,
  onCreated,
}: {
  categories: Category[];
  items: LineItem[];
  onClose: () => void;
  onCreated: (created: CreatedStructure) => void;
}) {
  const choices = categories.filter((c) => !c.archived && c.kind === "expense");
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState(choices[0]?.id ?? NEW_CATEGORY);
  const [newCategory, setNewCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give the line item a name");
    if (categoryId === NEW_CATEGORY && !newCategory.trim()) return setError("Name the new category");
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await createLineItem(
          name,
          categoryId === NEW_CATEGORY ? { newCategoryName: newCategory } : { categoryId },
          { categories, items }
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create it");
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New line item</DialogTitle>
          <DialogDescription>
            Adds a spending line to your budget and files this charge there. Tick “remember” and later charges from
            the same merchant go there too.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nli-name">Line item</Label>
            <Input id="nli-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Home furnishings" autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nli-category">Category</Label>
            <Select id="nli-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value={NEW_CATEGORY}>+ New category…</option>
            </Select>
          </div>
          {categoryId === NEW_CATEGORY && (
            <div className="space-y-2">
              <Label htmlFor="nli-new-category">New category name</Label>
              <Input
                id="nli-new-category"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="e.g. Shopping"
              />
            </div>
          )}
          <FormError>{error}</FormError>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create and file here"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Card charges with a destination picker each; changes save immediately. */
export function CardTransactionList({
  transactions,
  categories,
  items,
  oneOffs,
  onSaved,
  onCreated,
}: {
  transactions: Transaction[];
  categories: Category[];
  items: LineItem[];
  oneOffs: OneOff[];
  onSaved: (updated: Transaction[]) => void;
  /** Lets the picker create new line items; the parent adds them to its lists */
  onCreated?: (created: CreatedStructure) => void;
}) {
  const [remember, setRemember] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function assign(t: Transaction, value: string) {
    const d = parseDestination(value);
    setSavingId(t.id);
    setError(null);
    try {
      // "Remember" also files this merchant's other unfiled charges in the list (not for one-off links)
      const siblings =
        remember && !d.one_off_id
          ? transactions.filter((o) => o.id !== t.id && o.merchant === t.merchant && !o.line_item_id && !o.one_off_id && !o.excluded)
          : [];
      const updated = await updateTransactions([t.id, ...siblings.map((o) => o.id)], d);
      if (remember) await saveMerchantRules([{ merchant: t.merchant, destination: d }]);
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSavingId(null);
    }
  }

  if (!transactions.length) return <p className="text-sm text-[var(--color-muted-foreground)]">No card charges.</p>;

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-[var(--color-border)]">
        {transactions.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-medium">{t.merchant}</span>
                <span className={cn("tabular-nums", t.amount < 0 && "text-[var(--color-success)]")}>
                  {formatMoney(t.amount, true)}
                </span>
              </div>
              <p className="truncate text-xs text-[var(--color-muted-foreground)]">
                {formatDay(t.posted_on)} · {t.card_member ?? "—"} · {t.source_category ?? t.description}
              </p>
            </div>
            <DestinationSelect
              value={destinationValue(t)}
              onChange={(v) => assign(t, v)}
              categories={categories}
              items={items}
              oneOffs={oneOffs.filter((o) => o.month === t.month)}
              onCreated={onCreated}
              className="w-full sm:w-56"
              aria-label={`Where ${t.merchant} goes`}
              disabled={savingId === t.id}
            />
          </li>
        ))}
      </ul>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Remember my choice for this merchant in future imports
      </label>
      <FormError>{error}</FormError>
    </div>
  );
}

export function CardTransactionsDialog({
  title,
  description,
  onClose,
  ...listProps
}: {
  title: string;
  description?: string;
  onClose: () => void;
} & React.ComponentProps<typeof CardTransactionList>) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <CardTransactionList {...listProps} />
      </DialogContent>
    </Dialog>
  );
}
