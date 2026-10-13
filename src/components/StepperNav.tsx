import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/** ‹ Label › navigation used by the Month and Year pages. */
export function StepperNav({
  label,
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  prevLabel: string;
  nextLabel: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{label}</h1>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={onPrev} aria-label={prevLabel}>
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={onNext} aria-label={nextLabel}>
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
