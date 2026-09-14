import { Text, TextInput, View } from "react-native";

import { cn } from "@/lib/utils";

/**
 * Alto minimo de un campo, en dp y no en clases: en nativo NativeWind toma el
 * rem como 14, asi que h-12 son 42 dp y no 48. 48 es el minimo de toque de
 * Android.
 */
export const INPUT_MIN_HEIGHT = 48;

/**
 * El EditText de Android trae su propio relleno vertical y el de la fuente. Con
 * un alto fijo, texto + relleno no cabia y el contenido se desplazaba dentro del
 * campo; en Samsung, con su fuente y el tamano de letra del sistema, aun mas.
 * Sin ese relleno el alto lo pone el contenedor y, si la letra crece, crece el
 * campo en vez de recortarse.
 */
export const inputTextStyle = {
  paddingVertical: 0,
  includeFontPadding: false,
  textAlignVertical: "center",
};

export function Label({ className, children }) {
  return <Text className={cn("text-sm font-medium text-foreground", className)}>{children}</Text>;
}

export function Input({ className, style, ...props }) {
  return (
    <TextInput
      className={cn("rounded-lg border border-input bg-card px-3 text-base text-foreground", className)}
      style={[{ minHeight: INPUT_MIN_HEIGHT }, inputTextStyle, style]}
      placeholderTextColor="#94a3b8"
      {...props}
    />
  );
}

export function Textarea({ className, style, ...props }) {
  return (
    <TextInput
      multiline
      textAlignVertical="top"
      className={cn("min-h-[88px] rounded-lg border border-input bg-card p-3 text-base text-foreground", className)}
      style={[{ includeFontPadding: false }, style]}
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
