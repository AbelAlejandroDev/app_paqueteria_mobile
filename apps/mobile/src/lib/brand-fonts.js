import {
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold,
} from "@expo-google-fonts/hanken-grotesk";
import { Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold } from "@expo-google-fonts/poppins";

import { brand } from "@/lib/brand";

/**
 * Archivos de las tipografias que usan las marcas, por nombre de familia.
 * El nombre es el que va en brands/index.js (`fonts`) y en Tailwind.
 */
const FONT_FILES = {
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
};

/** Solo las familias de esta marca: es lo que se carga al arrancar. */
export const brandFontFiles = Object.fromEntries(
  Object.values(brand.fonts || {})
    .filter((name) => FONT_FILES[name])
    .map((name) => [name, FONT_FILES[name]])
);

/** Familia de la marca para un peso, para estilos fuera de Tailwind. */
export function brandFont(weight = "regular") {
  return brand.fonts?.[weight] || brand.fonts?.regular;
}
