/// <reference types="vitest/config" />
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  appType: "spa",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    // src/lib/supabase.ts throws without these; creating the client makes no requests
    env: { VITE_SUPABASE_URL: "http://localhost:54321", VITE_SUPABASE_ANON_KEY: "test" },
  },
});
