const { getBrand } = require("./brands");
const { getForegroundForColor } = require("./brands/color");

// El color de marca se hornea aquí, en tiempo de build: cada marca genera su
// propia app, así que no hace falta resolverlo en runtime como en la web.
const brand = getBrand();

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: brand.primaryColor,
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: brand.primaryColor,
          foreground: getForegroundForColor(brand.primaryColor),
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
        // Tonos de marca del detalle del item; ver `palette` en brands/index.js.
        ink: brand.palette.ink,
        tint: brand.palette.tint,
        glyph: brand.palette.glyph,
        sand: brand.palette.sand,
        success: brand.palette.success,
        canvas: brand.palette.canvas,
        media: brand.palette.media,
      },
      // Una familia por peso: con una fuente cargada a mano, Android no
      // sintetiza la negrita a partir de fontWeight y la dejaria en regular.
      fontFamily: {
        hanken: ["HankenGrotesk_400Regular"],
        "hanken-medium": ["HankenGrotesk_500Medium"],
        "hanken-semibold": ["HankenGrotesk_600SemiBold"],
        "hanken-bold": ["HankenGrotesk_700Bold"],
      },
      borderRadius: {
        sm: "2px",
        md: "4px",
        lg: "6px",
      },
    },
  },
  plugins: [],
};
