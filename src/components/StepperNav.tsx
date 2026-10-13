import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PeriodPicker, type PeriodPickerProps } from "@/components/PeriodPicker";

/**
 * ‹ Label › navigation used by the Dashboard, Month and Year pages. With `picker`, the label opens a
 * popover to jump to any period; with `onToday`, a "Today" button returns to the current one.
 */
export function StepperNav({
  label,
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
  picker,
  onToday,
  todayLabel = "Today",
  size = "lg",
}: {
  label: React.ReactNode;
  onPrev: () => void;
  onNext: () => void;
  prevLabel: string;
  nextLabel: string;
  picker?: PeriodPickerProps;
  onToday?: () => void;
  todayLabel?: string;
  /** "md" renders a smaller h2, for a section inside a page */
  size?: "lg" | "md";
}) {
  const Heading = size === "lg" ? "h1" : "h2";
  const heading =
    size === "lg"
      ? "font-display text-3xl font-semibold tracking-tight sm:text-4xl"
      : "font-display text-2xl font-semibold tracking-tight sm:text-3xl";
  return (
    <div className="flex items-center gap-3">
      {picker ? (
        <Heading className={heading}>
          <PeriodPicker {...picker}>
            <button
              type="button"
              className="group inline-flex items-center gap-1.5 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
              title={picker.mode === "month" ? "Jump to month" : "Jump to year"}
            >
              <span className="decoration-2 underline-offset-4 group-hover:underline">{label}</span>
              <ChevronDown
                className="h-5 w-5 text-[var(--color-muted-foreground)] transition-transform group-data-[state=open]:rotate-180"
                aria-hidden
              />
            </button>
          </PeriodPicker>
        </Heading>
      ) : (
        <Heading className={heading}>{label}</Heading>
      )}
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={onPrev} aria-label={prevLabel}>
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={onNext} aria-label={nextLabel}>
          <ChevronRight />
        </Button>
        {onToday && (
          <Button variant="outline" size="sm" className="ml-1 h-8 px-3" onClick={onToday}>
            {todayLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
