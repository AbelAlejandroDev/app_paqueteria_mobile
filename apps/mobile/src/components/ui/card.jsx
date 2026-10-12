import { Text, View } from "react-native";

import { cn } from "@/lib/utils";

/** La sombra suave del diseño, teñida del verde oscuro de la marca. */
const CARD_SHADOW = {
  shadowColor: "#1D4E4A",
  shadowOpacity: 0.06,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 3 },
  elevation: 2,
};

export function Card({ className, style, ...props }) {
  return (
    <View
      className={cn("overflow-hidden rounded-xl border border-border bg-card", className)}
      style={[CARD_SHADOW, style]}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }) {
  return <View className={cn("gap-1.5 p-4", className)} {...props} />;
}

export function CardTitle({ className, ...props }) {
  return <Text className={cn("font-hanken-bold text-base text-foreground", className)} {...props} />;
}

export function CardDescription({ className, ...props }) {
  return <Text className={cn("font-hanken text-sm leading-5 text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }) {
  return <View className={cn("p-4 pt-0", className)} {...props} />;
}
