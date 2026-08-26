import { KeyboardAvoidingView, Modal as RNModal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { X } from "lucide-react-native";

import { cn } from "@/lib/utils";

/**
 * Sustituto nativo del Dialog de Radix que usa la web. Se presenta como hoja
 * inferior, que es lo idiomático en móvil para formularios y confirmaciones.
 *
 * En Android no se envuelve en KeyboardAvoidingView: aunque `behavior` sea
 * undefined, KAV mide el teclado y recorta la altura del cuerpo (el campo de
 * formulario quedaba tapado por el pie). Android ya reajusta la ventana solo
 * con adjustResize, así que el envoltorio solo hace falta en iOS.
 */
function SheetWrapper({ children }) {
  if (Platform.OS !== "ios") return children;

  return <KeyboardAvoidingView behavior="padding">{children}</KeyboardAvoidingView>;
}

export function Modal({ visible, onClose, title, description, children, footer }) {
  return (
    <RNModal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View className="flex-1 justify-end bg-black/50">
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <SheetWrapper>
          <View className="max-h-[80%] rounded-t-2xl border-t border-border bg-card">
            <View className="flex-row items-start gap-3 border-b border-border p-5">
              <View className="min-w-0 flex-1">
                <Text className="text-lg font-semibold text-foreground">{title}</Text>
                {description ? (
                  <Text className="mt-1 text-sm leading-5 text-muted-foreground">{description}</Text>
                ) : null}
              </View>
              <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Cerrar">
                <X size={22} color="#64748b" />
              </Pressable>
            </View>

            <ScrollView contentContainerClassName="gap-3 p-5" keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>

            {footer ? <View className="gap-2 border-t border-border p-5">{footer}</View> : null}
          </View>
        </SheetWrapper>
      </View>
    </RNModal>
  );
}

export function Notice({ tone = "amber", className, children }) {
  const tones = {
    amber: { container: "border-amber-200 bg-amber-50", label: "text-amber-900" },
    rose: { container: "border-rose-200 bg-rose-50", label: "text-rose-800" },
    sky: { container: "border-sky-200 bg-sky-50", label: "text-sky-900" },
    emerald: { container: "border-emerald-200 bg-emerald-50", label: "text-emerald-800" },
  };
  const styles = tones[tone] || tones.amber;

  return (
    <View className={cn("rounded-lg border p-4", styles.container, className)}>
      <Text className={cn("text-sm leading-5", styles.label)}>{children}</Text>
    </View>
  );
}
