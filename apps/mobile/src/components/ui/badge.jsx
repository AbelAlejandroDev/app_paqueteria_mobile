import { Text, View } from "react-native";

import { cn } from "@/lib/utils";

const VARIANTS = {
  default: { container: "border-primary bg-primary", label: "text-primary-foreground" },
  secondary: { container: "border-secondary bg-secondary", label: "text-secondary-foreground" },
  destructive: { container: "border-destructive bg-destructive", label: "text-destructive-foreground" },
  outline: { container: "border-border bg-transparent", label: "text-foreground" },
};

/**
 * A diferencia de la web, el color del texto no se hereda del contenedor:
 * en React Native tiene que ir en el propio <Text>. Por eso el estilo se
 * parte en `className` (contenedor) y `labelClassName` (texto).
 */
export function Badge({ variant = "default", className, labelClassName, children }) {
  const styles = VARIANTS[variant] || VARIANTS.default;

  return (
    <View className={cn("self-start rounded-md border px-2 py-0.5", styles.container, className)}>
      <Text className={cn("text-xs font-medium", styles.label, labelClassName)}>{children}</Text>
    </View>
  );
}
