import { Text, TextInput, View } from "react-native";

import { cn } from "@/lib/utils";

export function Label({ className, children }) {
  return <Text className={cn("text-sm font-medium text-foreground", className)}>{children}</Text>;
}

export function Input({ className, ...props }) {
  return (
    <TextInput
      className={cn("h-11 rounded-lg border border-input bg-card px-3 text-base text-foreground", className)}
      placeholderTextColor="#94a3b8"
      {...props}
    />
  );
}

export function Textarea({ className, ...props }) {
  return (
    <TextInput
      multiline
      textAlignVertical="top"
      className={cn("min-h-[88px] rounded-lg border border-input bg-card p-3 text-base text-foreground", className)}
      placeholderTextColor="#94a3b8"
      {...props}
    />
  );
}

export function Field({ label, className, children }) {
  return (
    <View className={cn("gap-1.5", className)}>
      <Label>{label}</Label>
      {children}
    </View>
  );
}
