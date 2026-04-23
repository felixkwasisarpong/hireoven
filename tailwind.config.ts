import type { Config } from "tailwindcss"

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      keyframes: {
        "float-iphone": {
          "0%, 100%": { transform: "translateY(0) rotate(0deg)" },
          "50%": { transform: "translateY(-12px) rotate(0.5deg)" },
        },
        "aurora-orb": {
          "0%, 100%": { opacity: "0.45", transform: "scale(1) translate(0, 0)" },
          "33%": { opacity: "0.75", transform: "scale(1.08) translate(4px, -4px)" },
          "66%": { opacity: "0.6", transform: "scale(1.04) translate(-3px, 2px)" },
        },
        "feed-ticker": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-3px)" },
        },
        "extension-breathe": {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.07)" },
        },
        "live-ping": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
        "shimmer": {
          "0%": { backgroundPosition: "200% 50%" },
          "100%": { backgroundPosition: "-200% 50%" },
        },
      },
      animation: {
        "float-iphone": "float-iphone 5.5s ease-in-out infinite",
        "aurora-orb": "aurora-orb 10s ease-in-out infinite",
        "feed-ticker": "feed-ticker 2.8s ease-in-out infinite",
        "live-ping": "live-ping 1.4s ease-in-out infinite",
        shimmer: "shimmer 2.2s ease-in-out infinite",
        "extension-breathe": "extension-breathe 2.4s ease-in-out infinite",
      },
      colors: {
        teal: {
          DEFAULT: "#1D9E75",
          50: "#E8F7F2",
          100: "#D1EFE5",
          500: "#1D9E75",
          600: "#188560",
          700: "#126B4D",
        },
        brand: {
          DEFAULT: "hsl(var(--primary))",
          hover: "hsl(var(--primary-hover))",
          navy: "#062246",
          tint: "#FFF1E8",
          "tint-strong": "#FFD2B8",
        },
        surface: {
          DEFAULT: "hsl(var(--surface))",
          alt: "hsl(var(--surface-alt))",
          muted: "hsl(var(--surface-muted))",
          inset: "hsl(var(--surface-inset))",
        },
        strong: "hsl(var(--text-strong))",
        subtle: "hsl(var(--text-subtle))",
        success: {
          DEFAULT: "hsl(var(--success))",
          soft: "hsl(var(--success-soft))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          soft: "hsl(var(--warning-soft))",
        },
        danger: {
          DEFAULT: "hsl(var(--danger))",
          soft: "hsl(var(--danger-soft))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          hover: "hsl(var(--primary-hover))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
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

export default config
