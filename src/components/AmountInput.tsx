import { useEffect, useRef, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import type { CellSaver } from "@/hooks/useCellSaver";
import { parseAmount } from "@/lib/budget";
import { cn } from "@/lib/utils";

/**
 * Dollar input that saves on blur. Enter calls `onEnter` (move to the next field),
 * Escape reverts. Pass `data-*` attributes through `dataAttrs` for keyboard navigation.
 */
export function AmountInput({
  id,
  value,
  saver,
  onEnter,
  ariaLabel,
  compact = false,
  dataAttrs,
  covered = false,
}: {
  id?: string;
  value: number | undefined;
  saver: CellSaver;
  onEnter?: (input: HTMLInputElement) => void;
  ariaLabel?: string;
  compact?: boolean;
  dataAttrs?: Record<string, string | number>;
  /** The line already has money from elsewhere (card charges): don't look "not entered" */
  covered?: boolean;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const [isFocused, setIsFocused] = useState(false);
  const focused = useRef(false);
  const cancelled = useRef(false);

  // Keep in sync with outside changes (e.g. "Fill recurring") while not editing
  useEffect(() => {
    if (!focused.current) setText(value === undefined ? "" : String(value));
  }, [value]);

  const { state } = saver;

  return (
    <div className="relative">
      {!compact && (
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-[var(--color-muted-foreground)]">
          $
        </span>
      )}
      <input
        id={id}
        data-amount
        {...Object.fromEntries(Object.entries(dataAttrs ?? {}).map(([k, v]) => [`data-${k}`, v]))}
        inputMode="decimal"
        autoComplete="off"
        aria-label={ariaLabel}
        aria-invalid={state === "error" || undefined}
        title={saver.message ?? undefined}
        className={cn(
          "rounded-md border bg-transparent text-right tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
          compact
            ? "h-8 w-[4.25rem] px-1 pr-3.5 text-sm"
            : "h-9 w-32 pl-6 pr-7 text-base md:text-sm",
          state === "error" ? "border-[var(--color-destructive)]" : "border-[var(--color-input)]",
          value === undefined && !covered && "border-dashed",
          compact && value !== undefined && state !== "error" && "border-transparent hover:border-[var(--color-input)]"
        )}
        placeholder={compact ? "" : covered ? "+ more" : "—"}
        // In the grid, show "4,700" while not editing; raw digits while editing
        value={compact && !isFocused && text !== "" && !Number.isNaN(Number(text)) ? formatPlain(Number(text)) : text}
        onFocus={(e) => {
          focused.current = true;
          setIsFocused(true);
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => {
          setText(e.target.value);
          if (state !== "idle") saver.reset();
        }}
        onBlur={async (e) => {
          focused.current = false;
          setIsFocused(false);
          if (cancelled.current) {
            cancelled.current = false;
            return;
          }
          const raw = e.target.value;
          const ok = await saver.commit(raw);
          if (ok) {
            const parsed = parseAmount(raw);
            setText(parsed === null || Number.isNaN(parsed) ? "" : String(parsed));
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (onEnter) onEnter(e.currentTarget);
            else e.currentTarget.blur();
          } else if (e.key === "Escape") {
            cancelled.current = true;
            setText(value === undefined ? "" : String(value));
            saver.reset();
            e.currentTarget.blur();
          }
        }}
      />
      <span className={cn("absolute top-1/2 -translate-y-1/2", compact ? "right-1" : "right-2")} aria-live="polite">
        {state === "saving" && <Loader2 className="h-3 w-3 animate-spin text-[var(--color-muted-foreground)]" />}
        {state === "saved" && !compact && <Check className="h-3.5 w-3.5 text-[var(--color-success)]" aria-label="Saved" />}
        {state === "error" && <X className="h-3 w-3 text-[var(--color-destructive)]" aria-label="Not saved" />}
      </span>
    </div>
  );
}

const plain = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
function formatPlain(n: number): string {
  return plain.format(n);
}
