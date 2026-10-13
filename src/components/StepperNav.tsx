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
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" onClick={onPrev} aria-label={prevLabel}>
        <ChevronLeft />
      </Button>
      <h1 className="min-w-40 text-center text-xl font-semibold sm:text-2xl">{label}</h1>
      <Button variant="ghost" size="icon" onClick={onNext} aria-label={nextLabel}>
        <ChevronRight />
      </Button>
    </div>
  );
}
