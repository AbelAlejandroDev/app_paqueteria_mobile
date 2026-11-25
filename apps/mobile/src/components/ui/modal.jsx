import { useEffect, useState } from "react";
import { Alert, Keyboard, KeyboardAvoidingView, Modal as RNModal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { cn } from "@/lib/utils";
import { sheetMaxHeight } from "@/lib/sheet-layout";

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

/** Alto del teclado en iOS mientras la hoja esta abierta; 0 en Android o cerrado. */
function useIosKeyboardHeight(active) {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "ios" || !active) return undefined;
    const show = Keyboard.addListener("keyboardWillShow", (event) => setHeight(event?.endCoordinates?.height || 0));
    const hide = Keyboard.addListener("keyboardWillHide", () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
      setHeight(0);
    };
  }, [active]);
  return height;
}

/** El padding que ya tenia el pie, sobre el que se suma la zona segura. */
const SHEET_PADDING = 20;

/**
 * Pregunta antes de cerrar un formulario con cambios. "Keep editing" es la
 * opcion por defecto: cerrar sin querer no puede costar lo escrito.
 */
export function confirmDiscard(onDiscard, { title = "Discard changes?", message = "What you entered in this form will be lost." } = {}) {
  Alert.alert(title, message, [
    { text: "Keep editing", style: "cancel" },
    { text: "Discard", style: "destructive", onPress: onDiscard },
  ]);
}

/**
 * @param {object} props
 * @param {boolean} [props.dirty] - hay cambios sin enviar: cerrar (fondo, X, atras de Android) pide confirmacion.
 * @param {boolean} [props.busy] - hay una operacion en curso: no se cierra hasta que termine.
 */
export function Modal({ visible, onClose, title, description, children, footer, dirty = false, busy = false }) {
  // La hoja llega hasta el borde inferior de la pantalla, detras de la barra de
  // navegacion de Android y del indicador de inicio del iPhone. Sin reservar esa
  // zona, los botones del pie quedaban debajo de los botones del sistema en los
  // telefonos con navegacion de tres botones. El valor lo da el sistema, asi que
  // vale igual para gestos, tres botones, tablets e iPhone.
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const bottomPadding = SHEET_PADDING + insets.bottom;
  // En pixeles y no en %: dentro de KeyboardAvoidingView (que no tiene altura
  // propia) un max-height en porcentaje no limita nada, y la hoja crecia por
  // encima de la pantalla: la cabecera quedaba cortada bajo la isla dinamica.
  // iOS: el teclado entra como padding del KeyboardAvoidingView, asi que la
  // hoja encoge lo mismo (lib/sheet-layout). Android reajusta la ventana solo.
  const keyboardHeight = useIosKeyboardHeight(visible);
  const maxHeight = sheetMaxHeight({ windowHeight, topInset: insets.top, keyboardHeight });

  const requestClose = () => {
    if (busy) return;
    if (dirty) confirmDiscard(onClose);
    else onClose?.();
  };

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={requestClose}
      statusBarTranslucent
      // Explicito y no por defecto: la hoja pinta su fondo hasta abajo y se
      // separa del sistema con el padding, en vez de dejar una franja vacia.
      navigationBarTranslucent
    >
      <View className="flex-1 justify-end bg-black/50">
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={requestClose}
          accessibilityLabel="Close"
          accessibilityRole="button"
        />

        <SheetWrapper>
          <View className="rounded-t-2xl border-t border-border bg-card" style={{ maxHeight }}>
            <View className="items-center pt-2">
              <View className="h-1 w-10 rounded-full bg-ink/15" />
            </View>
            <View className="flex-row items-start gap-3 border-b border-border px-5 pb-4 pt-3">
              <View className="min-w-0 flex-1">
                <Text className="font-brand-bold text-lg leading-6 text-foreground" accessibilityRole="header">
                  {title}
                </Text>
                {description ? (
                  <Text className="mt-1 font-brand text-sm leading-5 text-muted-foreground">{description}</Text>
                ) : null}
              </View>
              <Pressable
                onPress={requestClose}
                disabled={busy}
                hitSlop={12}
                accessibilityLabel="Close"
                accessibilityRole="button"
                className="h-9 w-9 items-center justify-center rounded-full bg-muted"
              >
                <X size={20} color="#2D2A26" />
              </Pressable>
            </View>

            <ScrollView
              // Encoge para que el pie quede siempre a la vista: lo que no cabe
              // se desplaza, los botones no.
              style={{ flexGrow: 0, flexShrink: 1 }}
              contentContainerClassName="gap-3 px-5 pt-5"
              // Sin pie, el ultimo elemento es el contenido: es el que necesita la
              // zona segura.
              contentContainerStyle={{ paddingBottom: footer ? SHEET_PADDING : bottomPadding }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
            >
              {children}
            </ScrollView>

            {footer ? (
              <View
                className="gap-2 border-t border-border px-5 pt-4"
                style={{ paddingBottom: bottomPadding }}
              >
                {footer}
              </View>
            ) : null}
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
    <View className={cn("rounded-xl border p-4", styles.container, className)}>
      <Text className={cn("font-brand text-sm leading-5", styles.label)}>{children}</Text>
    </View>
  );
}
