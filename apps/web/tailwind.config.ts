import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: "var(--brand)",
        "brand-soft": "var(--brand-soft)",
        "brand-contrast": "var(--brand-contrast)",
        "surface-0": "var(--surface-0)",
        "surface-1": "var(--surface-1)",
        "ink-strong": "var(--ink-strong)",
        "ink-soft": "var(--ink-soft)",
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
