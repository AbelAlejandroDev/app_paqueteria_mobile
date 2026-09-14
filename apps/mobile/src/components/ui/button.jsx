import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { cn } from "@/lib/utils";

const VARIANTS = {
  default: { container: "border-primary bg-primary", label: "text-primary-foreground", spinner: "#0f172a" },
  outline: { container: "border-border bg-card", label: "text-foreground", spinner: "#0f172a" },
  secondary: { container: "border-secondary bg-secondary", label: "text-secondary-foreground", spinner: "#0f172a" },
  destructive: { container: "border-destructive bg-destructive", label: "text-destructive-foreground", spinner: "#ffffff" },
};

/**
 * Alto minimo y no fijo, en dp. Con un alto fijo, la letra grande del sistema
 * (habitual en Samsung) partia la etiqueta en dos lineas y la segunda quedaba
 * cortada. Con minimo, el boton crece con su texto.
 */
const SIZES = {
  default: { container: "px-4 py-2", label: "text-base", minHeight: 44 },
  sm: { container: "px-3 py-1.5", label: "text-sm", minHeight: 36 },
  lg: { container: "px-5 py-2", label: "text-base", minHeight: 48 },
};

export function Button({
  variant = "default",
  size = "default",
  className,
  labelClassName,
  loading = false,
  disabled = false,
  icon = null,
  children,
  style,
  ...props
}) {
  const styles = VARIANTS[variant] || VARIANTS.default;
  const sizing = SIZES[size] || SIZES.default;
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      className={cn(
        "flex-row items-center justify-center gap-2 rounded-lg border",
        styles.container,
        sizing.container,
        isDisabled && "opacity-60",
        className
      )}
      style={[{ minHeight: sizing.minHeight }, style]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator size="small" color={styles.spinner} />
      ) : (
        <>
          {icon ? <View>{icon}</View> : null}
          <Text className={cn("shrink text-center font-semibold", styles.label, sizing.label, labelClassName)}>{children}</Text>
        </>
      )}
    </Pressable>
  );
}
