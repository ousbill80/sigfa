/**
 * KIOSK-001 — tailwind.config.ts
 * Configuration Tailwind 4 utilisant les tokens CSS.
 */
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{ts,tsx}",
    "./src/app/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        "surface-kiosk": "var(--surface-kiosk)",
        "surface-screen": "var(--surface-screen)",
        "surface-0": "var(--surface-0)",
        "surface-1": "var(--surface-1)",
        "ink-inverse": "var(--ink-inverse)",
        "ink-strong": "var(--ink-strong)",
        "ink-soft": "var(--ink-soft)",
        "ink-muted-inv": "var(--ink-muted-inv)",
        brand: "var(--brand)",
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)",
        info: "var(--info)",
      },
    },
  },
  plugins: [],
};

export default config;
