import { Text, View } from "react-native";

import { cn } from "@/lib/utils";

export function Card({ className, ...props }) {
  return <View className={cn("overflow-hidden rounded-lg border border-border bg-card", className)} {...props} />;
}

export function CardHeader({ className, ...props }) {
  return <View className={cn("gap-1.5 p-4", className)} {...props} />;
}

export function CardTitle({ className, ...props }) {
  return <Text className={cn("text-base font-semibold text-foreground", className)} {...props} />;
}

export function CardDescription({ className, ...props }) {
  return <Text className={cn("text-sm leading-5 text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }) {
  return <View className={cn("p-4 pt-0", className)} {...props} />;
}
