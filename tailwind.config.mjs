/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      colors: {
        surface: "var(--color-surface)",
        "surface-hover": "var(--color-surface-hover)",
        border: "var(--color-border)",
        "border-active": "var(--color-border-active)",
        accent: "var(--color-accent)",
        "accent-hover": "var(--color-accent-hover)",
        "accent-secondary": "var(--color-accent-secondary)",
      },
      typography: {
        DEFAULT: {
          css: {
            "--tw-prose-body": "var(--color-text)",
            "--tw-prose-headings": "var(--color-text)",
            "--tw-prose-links": "var(--color-accent)",
            "--tw-prose-bold": "var(--color-text)",
            "--tw-prose-code": "var(--color-accent)",
            "--tw-prose-pre-bg": "var(--color-surface)",
            "--tw-prose-pre-code": "var(--color-text)",
            "--tw-prose-quotes": "var(--color-text-secondary)",
            "--tw-prose-quote-borders": "var(--color-accent)",
            "--tw-prose-counters": "var(--color-text-muted)",
            "--tw-prose-bullets": "var(--color-text-muted)",
            "--tw-prose-hr": "var(--color-border)",
            "--tw-prose-th-borders": "var(--color-border)",
            "--tw-prose-td-borders": "var(--color-border)",
            h1: { fontFamily: "JetBrains Mono, monospace" },
            h2: { fontFamily: "JetBrains Mono, monospace" },
            h3: { fontFamily: "JetBrains Mono, monospace" },
            h4: { fontFamily: "JetBrains Mono, monospace" },
            a: {
              textDecoration: "none",
              "&:hover": { textDecoration: "underline" },
            },
            blockquote: {
              borderLeftColor: "var(--color-accent)",
              borderLeftWidth: "3px",
            },
            code: {
              backgroundColor: "var(--color-surface)",
              padding: "0.15em 0.35em",
              borderRadius: "0.25rem",
              fontWeight: "400",
            },
            "code::before": { content: "none" },
            "code::after": { content: "none" },
          },
        },
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
