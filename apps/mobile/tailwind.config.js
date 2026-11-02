const { getBrand } = require("./brands");
const { getForegroundForColor, mixWithWhite } = require("./brands/color");

// El color de marca se hornea aquí, en tiempo de build: cada marca genera su
// propia app, así que no hace falta resolverlo en runtime como en la web.
const brand = getBrand();

const { palette } = brand;
const onPrimary = palette.onPrimary || getForegroundForColor(brand.primaryColor);

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Los tokens genericos salen de la paleta de la marca: asi cada
        // pantalla que usa bg-background, text-foreground o border-border
        // queda con el lienzo, la tinta y los bordes del diseño sin tocarla.
        // Una marca puede fijar su borde y su texto secundario (HDG); si no,
        // salen de la tinta.
        border: palette.border || mixWithWhite(palette.ink, 0.1),
        input: mixWithWhite(palette.ink, 0.14),
        ring: brand.primaryColor,
        background: palette.canvas,
        foreground: palette.ink,
        primary: {
          DEFAULT: brand.primaryColor,
          foreground: onPrimary,
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
          DEFAULT: mixWithWhite(palette.ink, 0.06),
          foreground: palette.mutedForeground || mixWithWhite(palette.ink, 0.62),
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
          DEFAULT: "#FFFFFF",
          foreground: palette.ink,
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
      // La tipografia de la marca, una familia por peso: con una fuente
      // cargada a mano, Android no sintetiza la negrita a partir de
      // fontWeight y la dejaria en regular. The Worx usa Hanken Grotesk y HDG
      // Poppins; las clases son las mismas (font-brand-*).
      fontFamily: {
        brand: [brand.fonts.regular],
        "brand-medium": [brand.fonts.medium],
        "brand-semibold": [brand.fonts.semibold],
        "brand-bold": [brand.fonts.bold],
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
