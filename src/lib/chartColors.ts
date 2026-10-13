import { useEffect, useState } from "react";

// Validated categorical palette (fixed order; never cycled). Light steps for the light
// surface, dark steps re-stepped for the dark surface.
const CATEGORICAL = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};

export type ChartColors = {
  categorical: string[];
  income: string;
  spending: string;
  savings: string;
  /** Neutral ink for the "left over" line and "Other" folds */
  neutral: string;
  grid: string;
  axis: string;
  surface: string;
  tooltipBg: string;
  tooltipText: string;
};

function colorsFor(theme: "light" | "dark"): ChartColors {
  const c = CATEGORICAL[theme];
  return {
    categorical: c,
    income: c[0],
    spending: c[1],
    savings: c[2],
    neutral: theme === "dark" ? "#c3c2b7" : "#52514e",
    grid: theme === "dark" ? "#2e2e2c" : "#ebeae6",
    axis: theme === "dark" ? "#a3a29b" : "#6b6a65",
    surface: theme === "dark" ? "#262626" : "#ffffff",
    tooltipBg: theme === "dark" ? "#1a1a19" : "#ffffff",
    tooltipText: theme === "dark" ? "#f0efec" : "#0b0b0b",
  };
}

function currentTheme(): "light" | "dark" {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

/** Chart colors that follow the app's light/dark toggle. */
export function useChartColors(): ChartColors {
  const [theme, setTheme] = useState(currentTheme);
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(currentTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return colorsFor(theme);
}
