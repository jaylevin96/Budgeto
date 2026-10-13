import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// Apply saved theme before first paint to avoid flash
const stored = localStorage.getItem("budgeto-theme");
if (stored === "dark" || stored === "light") {
  document.documentElement.setAttribute("data-theme", stored);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
