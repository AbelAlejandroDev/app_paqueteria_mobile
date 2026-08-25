import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { cn } from "@/lib/utils";

const VARIANTS = {
  default: { container: "border-primary bg-primary", label: "text-primary-foreground", spinner: "#0f172a" },
  outline: { container: "border-border bg-card", label: "text-foreground", spinner: "#0f172a" },
  secondary: { container: "border-secondary bg-secondary", label: "text-secondary-foreground", spinner: "#0f172a" },
  destructive: { container: "border-destructive bg-destructive", label: "text-destructive-foreground", spinner: "#ffffff" },
};

const SIZES = {
  default: { container: "h-11 px-4", label: "text-base" },
  sm: { container: "h-9 px-3", label: "text-sm" },
  lg: { container: "h-12 px-5", label: "text-base" },
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
      {...props}
    >
      {loading ? (
        <ActivityIndicator size="small" color={styles.spinner} />
      ) : (
        <>
          {icon ? <View>{icon}</View> : null}
          <Text className={cn("font-semibold", styles.label, sizing.label, labelClassName)}>{children}</Text>
        </>
      )}
    </Pressable>
  );
}
