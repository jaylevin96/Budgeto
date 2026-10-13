import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { currentMonthKey, monthKey, MONTH_SHORT, parseMonthKey } from "@/lib/budget";
import { cn } from "@/lib/utils";

export type PeriodPickerProps =
  | { mode: "month"; value: string; onSelect: (month: string) => void }
  | { mode: "year"; value: number; onSelect: (year: number) => void };

const cellClass =
  "rounded-xl px-2 py-2 text-sm font-semibold tabular-nums transition-colors hover:bg-[var(--color-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]";
const selectedClass = "bg-[var(--color-accent)] text-[var(--color-accent-foreground)] hover:bg-[var(--color-accent)]";
const currentClass = "ring-1 ring-inset ring-[var(--color-primary)]";

/** Popover for jumping straight to a month or year; `children` is the trigger. */
export function PeriodPicker({ children, ...props }: PeriodPickerProps & { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          collisionPadding={16}
          className="z-50 w-72 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-[var(--color-foreground)] shadow-lg"
        >
          {/* Remount on open so the visible page starts at the current value */}
          {open &&
            (props.mode === "month" ? (
              <MonthGrid
                value={props.value}
                onSelect={(m) => {
                  setOpen(false);
                  props.onSelect(m);
                }}
              />
            ) : (
              <YearGrid
                value={props.value}
                onSelect={(y) => {
                  setOpen(false);
                  props.onSelect(y);
                }}
              />
            ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function PagerHeader({ label, onPrev, onNext, prevLabel, nextLabel }: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  prevLabel: string;
  nextLabel: string;
}) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onPrev} aria-label={prevLabel}>
        <ChevronLeft />
      </Button>
      <span className="text-sm font-semibold tabular-nums">{label}</span>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onNext} aria-label={nextLabel}>
        <ChevronRight />
      </Button>
    </div>
  );
}

function MonthGrid({ value, onSelect }: { value: string; onSelect: (month: string) => void }) {
  const selected = parseMonthKey(value);
  const today = currentMonthKey();
  const [year, setYear] = useState(selected.year);
  return (
    <div>
      <PagerHeader
        label={String(year)}
        onPrev={() => setYear(year - 1)}
        onNext={() => setYear(year + 1)}
        prevLabel="Previous year"
        nextLabel="Next year"
      />
      <div className="grid grid-cols-4 gap-1">
        {MONTH_SHORT.map((name, m) => {
          const key = monthKey(year, m);
          return (
            <button
              key={name}
              type="button"
              aria-pressed={key === value}
              onClick={() => onSelect(key)}
              className={cn(cellClass, key === today && currentClass, key === value && selectedClass)}
            >
              {name}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-end border-t border-[var(--color-border)] pt-2">
        <Button variant="ghost" size="sm" className="h-8" onClick={() => onSelect(today)}>
          This month
        </Button>
      </div>
    </div>
  );
}

function YearGrid({ value, onSelect }: { value: number; onSelect: (year: number) => void }) {
  const thisYear = parseMonthKey(currentMonthKey()).year;
  // Pages of 12, with the value in the middle row
  const [start, setStart] = useState(value - 5);
  const years = Array.from({ length: 12 }, (_, i) => start + i);
  return (
    <div>
      <PagerHeader
        label={`${years[0]}–${years[11]}`}
        onPrev={() => setStart(start - 12)}
        onNext={() => setStart(start + 12)}
        prevLabel="Earlier years"
        nextLabel="Later years"
      />
      <div className="grid grid-cols-4 gap-1">
        {years.map((y) => (
          <button
            key={y}
            type="button"
            aria-pressed={y === value}
            onClick={() => onSelect(y)}
            className={cn(cellClass, y === thisYear && currentClass, y === value && selectedClass)}
          >
            {y}
          </button>
        ))}
      </div>
      <div className="mt-2 flex justify-end border-t border-[var(--color-border)] pt-2">
        <Button variant="ghost" size="sm" className="h-8" onClick={() => onSelect(thisYear)}>
          This year
        </Button>
      </div>
    </div>
  );
}
