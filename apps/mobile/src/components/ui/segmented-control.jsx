import { Pressable, ScrollView, Text } from "react-native";

import { brand } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * Equivalente móvil de las <Tabs> de la web.
 *
 * Antes cada opción ocupaba un tercio fijo del ancho. En un teléfono de 320px
 * eso dejaba unos 69px para el texto, y "Statement" en negrita necesita unos 72:
 * se partía en dos líneas.
 *
 * Ahora cada opción mide lo que su texto necesita y nunca menos, así que la
 * etiqueta no se parte. Si caben todas, crecen hasta llenar la fila y se ve
 * como antes; si no caben —pantalla estrecha o letra del sistema agrandada—, la
 * fila se desplaza en horizontal. No se baja el tamaño de letra para que quepa:
 * eso lo haría ilegible justo a quien la agrandó.
 */
export function SegmentedControl({ options, value, onChange, className }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className={cn("rounded-2xl bg-white", className)}
      // flexGrow permite que las opciones llenen el ancho cuando sobra espacio.
      contentContainerStyle={{ flexGrow: 1, padding: 6, gap: 6 }}
      // Barra blanca con la sombra suave del resto del diseño.
      style={{
        shadowColor: "#1D4E4A",
        shadowOpacity: 0.06,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 3 },
        elevation: 2,
      }}
    >
      {options.map((option) => {
        const active = option.value === value;

        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            // flexShrink 0: nunca por debajo de lo que pide el texto.
            style={{ flexGrow: 1, flexShrink: 0, minHeight: 42, backgroundColor: active ? brand.primaryColor : "transparent" }}
            className={cn("items-center justify-center rounded-xl px-4", !active && "active:opacity-70")}
          >
            <Text
              numberOfLines={1}
              className={cn("text-sm", active ? "font-hanken-bold text-white" : "font-hanken-semibold text-ink")}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
