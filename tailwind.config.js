/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        ink: "#000000",
        "ink-soft": "#1a1a1a",
        paper: "#ffffff",
        hairline: "#e0e0e0",
        link: "#057dbc",
        "body-grey": "#757575",
        "canvas-soft": "#f5f5f5",
      },
      fontFamily: {
        "wired-serif": ["Georgia", "Times New Roman", "serif"],
      },
      fontSize: {
        "wired-display-hero": [
          "64px",
          { lineHeight: "59.52px", letterSpacing: "-0.5px" },
        ],
        "wired-display-lg": [
          "48px",
          { lineHeight: "50.4px", letterSpacing: "-0.4px" },
        ],
        "wired-display-md": [
          "32px",
          { lineHeight: "35.2px", letterSpacing: "-0.3px" },
        ],
        "wired-display-sm": [
          "26px",
          { lineHeight: "28.08px", letterSpacing: "0" },
        ],
        "wired-eyebrow": [
          "12px",
          { lineHeight: "16px", letterSpacing: "0.08em" },
        ],
        "wired-meta": [
          "13px",
          { lineHeight: "18px", letterSpacing: "0.04em" },
        ],
        "wired-button-md": [
          "16px",
          { lineHeight: "20px", letterSpacing: "0.3px" },
        ],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [],
}
