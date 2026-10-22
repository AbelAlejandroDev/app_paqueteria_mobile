import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, Pressable, Text, useWindowDimensions, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { brand } from "@/lib/brand";
import { cardPlacement, highlightRect } from "@/lib/tour-layout";
import { Button } from "@/components/ui/button";
import { TOUR_ILLUSTRATIONS } from "./illustrations";

const { palette } = brand;

/** Velo sobre el resto: suave, para que la app se siga reconociendo debajo. */
const SCRIM = "rgba(17, 32, 29, 0.55)";
const RADIUS = 14;

/** Rectangulo redondeado como trazo SVG, para recortarlo del velo. */
function roundedRectPath({ x, y, width, height }, r) {
  const radius = Math.min(r, width / 2, height / 2);
  return [
    `M${x + radius},${y}`,
    `H${x + width - radius}`,
    `A${radius},${radius} 0 0 1 ${x + width},${y + radius}`,
    `V${y + height - radius}`,
    `A${radius},${radius} 0 0 1 ${x + width - radius},${y + height}`,
    `H${x + radius}`,
    `A${radius},${radius} 0 0 1 ${x},${y + height - radius}`,
    `V${y + radius}`,
    `A${radius},${radius} 0 0 1 ${x + radius},${y}`,
    "Z",
  ].join(" ");
}

function ProgressDots({ index, total }) {
  return (
    <View className="flex-row items-center gap-1.5" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: total }).map((_, dot) => (
        <View
          key={dot}
          className="h-1.5 rounded-full"
          style={{
            width: dot === index ? 18 : 6,
            backgroundColor: dot === index ? brand.primaryColor : "#D5D4D2",
          }}
        />
      ))}
    </View>
  );
}

/**
 * Capa del recorrido: oscurece la app salvo el elemento que se explica y pone
 * al lado una tarjeta con el paso.
 *
 * Recoge todos los toques: mientras dura, nada de debajo se puede pulsar, asi
 * que el recorrido no puede pedir un escaneo, un reenvio ni un pago por error.
 */
export default function TourOverlay({ step, index, total, target, offset, onNext, onBack, onSkip }) {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  // En estado y no en ref: el compilador de React no deja leer refs al pintar.
  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);

  // Cada paso entra con un fundido breve; con "reducir movimiento", sin el.
  useEffect(() => {
    opacity.setValue(reduceMotion ? 1 : 0);
    if (!reduceMotion) {
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    }
  }, [index, reduceMotion, opacity]);

  // Las medidas llegan en coordenadas de ventana; la capa puede no empezar en
  // el 0 de la ventana, asi que se corrige con su propio desplazamiento.
  const local = target
    ? { x: target.x - (offset?.x || 0), y: target.y - (offset?.y || 0), width: target.width, height: target.height }
    : null;
  // Hasta el borde de la zona segura: mas abajo esta la barra de navegacion
  // del sistema, que tapaba el borde inferior del resaltado de las pestañas.
  const hole = highlightRect(local, { width: window.width, height: window.height - insets.bottom });
  const placement = cardPlacement({ highlight: hole, window, insets, cardHeight: cardHeight || 220 });
  const isLast = index === total - 1;
  const Illustration = step.illustration ? TOUR_ILLUSTRATIONS[step.illustration] || null : null;
  const warning = step.tone === "warning";

  return (
    <View
      className="absolute inset-0"
      // Por encima de todo, tambien en Android: alli el orden lo decide la
      // elevacion, y la barra de pestañas tiene la suya; sin esto quedaba
      // encima del velo y sin oscurecer.
      style={{ zIndex: 1000, elevation: 1000 }}
      // Atrapa todos los toques: la app de debajo no responde.
      onStartShouldSetResponder={() => true}
      accessibilityViewIsModal
    >
      <Svg width={window.width} height={window.height} style={{ position: "absolute", top: 0, left: 0 }}>
        {hole ? (
          <>
            <Path
              d={`M0,0 H${window.width} V${window.height} H0 Z ` + roundedRectPath(hole, RADIUS)}
              fill={SCRIM}
              fillRule="evenodd"
            />
            <Path d={roundedRectPath(hole, RADIUS)} fill="none" stroke={brand.primaryColor} strokeWidth={2.5} />
          </>
        ) : (
          <Rect x={0} y={0} width={window.width} height={window.height} fill={SCRIM} />
        )}
      </Svg>

      <Animated.View
        onLayout={(event) => setCardHeight(event.nativeEvent.layout.height)}
        className="absolute left-4 right-4 rounded-2xl border border-border bg-card p-4"
        style={{
          top: placement.top,
          opacity,
          maxWidth: 520,
          alignSelf: "center",
          shadowColor: brand.palette.shadow,
          shadowOpacity: 0.12,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }}
        accessibilityLiveRegion="polite"
      >
        <View className="mb-2 flex-row items-center justify-between">
          <Text className="font-brand-semibold text-xs uppercase tracking-wider" style={{ color: palette.glyph }}>
            {`Step ${index + 1} of ${total}`}
          </Text>
          <Pressable onPress={onSkip} hitSlop={12} accessibilityRole="button" accessibilityLabel="Skip tour">
            <Text className="font-brand-semibold text-sm text-muted-foreground">Skip</Text>
          </Pressable>
        </View>

        {Illustration ? (
          <View className="mb-3">
            <Illustration />
          </View>
        ) : null}

        <Text className="font-brand-bold text-lg text-foreground" accessibilityRole="header">
          {step.title}
        </Text>
        <Text className="mt-1 font-brand text-sm leading-5 text-muted-foreground">{step.description}</Text>
        {step.note ? (
          // El amarillo queda para el plazo de almacenaje: es la unica regla
          // del recorrido que puede costarle dinero al cliente si no actua.
          <View
            className={
              warning
                ? "mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2"
                : "mt-2 rounded-xl border border-border bg-background px-3 py-2"
            }
          >
            <Text className={warning ? "font-brand text-xs leading-5 text-amber-900" : "font-brand text-xs leading-5 text-foreground"}>
              {step.note}
            </Text>
          </View>
        ) : null}

        <View className="mt-4 flex-row items-center justify-between gap-3">
          <ProgressDots index={index} total={total} />
          <View className="flex-row gap-2">
            {index > 0 ? (
              <Button variant="outline" size="sm" onPress={onBack} accessibilityLabel="Previous step">
                Back
              </Button>
            ) : null}
            <Button size="sm" onPress={onNext}>
              {isLast ? "Finish" : "Next"}
            </Button>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}
