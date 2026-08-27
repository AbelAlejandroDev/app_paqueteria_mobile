import { Pressable, Text, View } from "react-native";

import { cn } from "@/lib/utils";

/**
 * Equivalente móvil de las <Tabs> de la web.
 *
 * La web usa una fila de pestañas con borde; en móvil el patrón nativo es el
 * control segmentado, que además cabe en el ancho de un teléfono sin scroll
 * horizontal mientras sean tres o cuatro opciones.
 */
export function SegmentedControl({ options, value, onChange, className }) {
  return (
    <View className={cn("flex-row rounded-lg border border-border bg-muted p-1", className)}>
      {options.map((option) => {
        const active = option.value === value;

        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            className={cn(
              "flex-1 items-center justify-center rounded-md px-3 py-2",
              active ? "bg-card" : "active:bg-card/50"
            )}
          >
            <Text
              className={cn(
                "text-sm",
                active ? "font-semibold text-foreground" : "font-medium text-muted-foreground"
              )}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
