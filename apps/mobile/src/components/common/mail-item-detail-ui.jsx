import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CheckCircle2,
  X,
  Clock3,
  Eye,
  FileText,
  Mail,
  Package2,
  Sparkles,
  XCircle,
} from "lucide-react-native";

import { brand } from "@/lib/brand";
import { brandMark, brandMonochromeMark } from "@/lib/brand-assets";
import { cn } from "@/lib/utils";

/**
 * Piezas visuales del detalle del item.
 *
 * Los grises salen de `ink` con opacidad y no de slate: el diseño es calido y
 * slate lo enfria. Los colores que van a un icono de lucide se pasan en hex
 * porque el icono no lee clases.
 */
const { palette } = brand;

/** Sombra difusa de las tarjetas, teñida del verde oscuro del diseño. */
const CARD_SHADOW = {
  shadowColor: "#1D4E4A",
  shadowOpacity: 0.06,
  shadowRadius: 20,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
};

const CARD_TONES = {
  default: "border-ink/[0.08] bg-white",
  amber: "border-amber-200 bg-amber-50",
  rose: "border-rose-200 bg-rose-50",
  emerald: "border-emerald-200 bg-emerald-50",
};

export function DetailCard({ tone = "default", className, style, ...props }) {
  return (
    <View
      className={cn("overflow-hidden rounded-xl border", CARD_TONES[tone] || CARD_TONES.default, className)}
      style={[CARD_SHADOW, style]}
      {...props}
    />
  );
}

export function CardHeading({ className, ...props }) {
  return <Text className={cn("font-hanken-bold text-[18px] tracking-tight text-ink", className)} {...props} />;
}

export function CardSubheading({ className, ...props }) {
  return <Text className={cn("mt-0.5 font-hanken text-[13px] leading-5 text-ink/60", className)} {...props} />;
}

/** "ACTIONS": rotulo pequeño en mayusculas encima de un grupo. */
export function SectionLabel({ children }) {
  return (
    <Text className="px-1 font-hanken-bold text-[11px] uppercase tracking-wider text-ink/60">{children}</Text>
  );
}

/** Logo y codigo del item en el centro de la cabecera. */
export function ItemHeaderTitle({ title }) {
  const mark = brandMonochromeMark || brandMark;

  return (
    <View className="flex-row items-center gap-2">
      <View
        className="h-6 w-6 items-center justify-center overflow-hidden rounded"
        style={{ backgroundColor: brandMonochromeMark ? brand.primaryColor : brand.markBackground }}
      >
        {mark ? (
          <Image
            source={mark}
            style={brandMonochromeMark ? { width: 17, height: 17 } : { width: "100%", height: "100%" }}
            contentFit="contain"
          />
        ) : null}
      </View>
      <Text className="font-hanken-bold text-[17px] tracking-tight text-ink" numberOfLines={1}>
        {title}
      </Text>
    </View>
  );
}

const IN_PROGRESS = ["READY_FOR_PICKUP", "SCAN_REQUESTED", "FORWARD_REQUESTED"];
const CLOSED = ["ARCHIVED", "DISCARDED"];

/** Rojo solo para lo que acabo sin hacerse: descartado o solicitud rechazada. */
const CLOSED_FILL = "#BE123C";

/** La sombra del diseño: 0 1px 2px 0 rgb(0 0 0 / 0.05). */
const PILL_SHADOW = {
  shadowColor: "#000000",
  shadowOpacity: 0.05,
  shadowRadius: 2,
  shadowOffset: { width: 0, height: 1 },
  elevation: 1,
};

/**
 * Estado del item sobre la foto.
 *
 * Todos van en el verde del diseño (#00A887); el icono es lo que distingue un
 * estado hecho de uno en marcha. `closedRequest` es el caso de "Forward
 * Rejected": la ultima solicitud se rechazo o cancelo y eso es lo que manda,
 * aunque el item siga en otro estado.
 */
export function StatusPill({ status, label, closedRequest = false }) {
  const isClosed = closedRequest || CLOSED.includes(status);
  const fill = isClosed ? CLOSED_FILL : palette.success;
  const Icon = isClosed ? XCircle : IN_PROGRESS.includes(status) ? Clock3 : CheckCircle2;

  return (
    // `shrink` y una linea: en una fila estrecha (la lista de Mail) un estado
    // largo se corta con "..." en vez de partirse y hacer mas alta la tarjeta.
    <View className="shrink flex-row items-center gap-1 rounded-md px-2.5 py-1" style={[PILL_SHADOW, { backgroundColor: fill }]}>
      <Icon size={13} color="#ffffff" />
      <Text className="shrink font-hanken-bold text-[11px] uppercase tracking-wide text-white" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** "Viewed" / "New", en blanco translucido debajo del estado. */
export function ViewPill({ label }) {
  const isNew = label !== "Viewed";
  const Icon = isNew ? Sparkles : Eye;

  return (
    <View className="flex-row items-center gap-1 rounded-md border border-ink/[0.12] bg-white px-2.5 py-1" style={PILL_SHADOW}>
      <Icon size={13} color={isNew ? brand.primaryColor : palette.glyph} />
      <Text className="font-hanken-medium text-[11px] uppercase text-ink">{label}</Text>
    </View>
  );
}

export function DetailRow({ label, children, value, last = false }) {
  return (
    <View
      className={cn(
        "flex-row items-center justify-between gap-4 py-2.5",
        !last && "border-b border-ink/[0.08]"
      )}
    >
      <Text className="font-hanken text-[14px] text-ink/60">{label}</Text>
      {children || (
        <Text className="max-w-[65%] text-right font-hanken-medium text-[14px] text-ink">{value}</Text>
      )}
    </View>
  );
}

/** El buzon, en el chip verde. */
export function MailboxChip({ children }) {
  return (
    <View className="rounded-md border border-primary/40 bg-tint/35 px-2.5 py-0.5">
      <Text className="font-hanken-bold text-[13px] text-ink">{children}</Text>
    </View>
  );
}

const TYPE_ICONS = { PACKAGE: Package2, LETTER: Mail, LARGE_ENVELOPE: FileText };

export function TypeChip({ type, label }) {
  const Icon = TYPE_ICONS[type] || Package2;

  return (
    <View className="flex-row items-center gap-1 rounded-md border border-ink/[0.12] bg-ink/[0.05] px-2 py-0.5">
      <Icon size={15} color={palette.glyph} />
      <Text className="font-hanken-bold text-[12px] uppercase text-ink">{label}</Text>
    </View>
  );
}

const ACTION_VARIANTS = {
  // El principal: relleno del color de marca, con la sombra teñida de el.
  primary: {
    container: "rounded-[10px] bg-primary px-4 py-3.5",
    label: "font-hanken-bold text-[15px] text-white",
    iconSize: 20,
    spinner: "#ffffff",
  },
  secondary: {
    container: "rounded-[10px] border border-ink/[0.18] bg-white px-4 py-3",
    label: "font-hanken-medium text-[14px] text-ink",
    iconSize: 18,
    spinner: palette.ink,
  },
  // Lo que no es un servicio sino un aviso al centro ("Not mine").
  tertiary: {
    container: "mt-1 rounded-[10px] border border-ink/[0.12] bg-white px-4 py-2.5",
    label: "font-hanken-medium text-[13px] text-ink",
    iconSize: 17,
    spinner: palette.ink,
  },
};

/**
 * Boton de accion del detalle.
 *
 * `icon` es el componente de lucide, no el elemento: el color y el tamaño los
 * pone la variante, que es lo que el diseño fija.
 */
export function ActionButton({ variant = "secondary", icon: Icon, iconColor, loading = false, disabled = false, className, children, ...props }) {
  const styles = ACTION_VARIANTS[variant] || ACTION_VARIANTS.secondary;
  const isDisabled = disabled || loading;
  const color = iconColor || (variant === "primary" ? "#ffffff" : palette.glyph);

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      className={cn(
        "flex-row items-center justify-center gap-2 active:opacity-80",
        styles.container,
        isDisabled && "opacity-60",
        className
      )}
      style={
        variant === "primary"
          ? {
              shadowColor: brand.primaryColor,
              shadowOpacity: 0.25,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 4 },
              elevation: 3,
            }
          : undefined
      }
      {...props}
    >
      {loading ? (
        <ActivityIndicator size="small" color={styles.spinner} />
      ) : (
        <>
          {Icon ? <Icon size={styles.iconSize} color={color} /> : null}
          <Text className={cn("shrink text-center", styles.label)}>{children}</Text>
        </>
      )}
    </Pressable>
  );
}

/**
 * Rejilla de acciones: la principal ocupa todo el ancho y el resto va de dos
 * en dos. Si sobra una, se estira sola en la ultima fila en vez de quedarse a
 * media anchura con un hueco al lado.
 */
export function ActionGrid({ primary, secondary = [] }) {
  const rows = [];
  for (let index = 0; index < secondary.length; index += 2) {
    rows.push(secondary.slice(index, index + 2));
  }

  return (
    <View className="gap-2.5">
      {primary}
      {rows.map((row, index) => (
        <View key={index} className="flex-row gap-2.5">
          {row.map((button, column) => (
            <View key={column} className="flex-1">
              {button}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/** Aviso de algo en marcha ("Forwarding in progress"), en el tono de marca. */
export function ProgressNotice({ icon: Icon, title, children }) {
  return (
    <View className="flex-row items-start gap-3 rounded-[10px] border border-primary/40 bg-tint/25 p-4">
      <View className="h-10 w-10 items-center justify-center rounded-full bg-primary">
        <Icon size={19} color="#ffffff" />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="font-hanken-bold text-[14px] text-ink">{title}</Text>
        <Text className="mt-1 font-hanken text-[13px] leading-5 text-ink/70">{children}</Text>
      </View>
    </View>
  );
}

/**
 * Historial en vertical. El evento mas reciente va arriba con el punto del
 * color de marca; los anteriores, en arena.
 */
export function Timeline({ events, renderExtra }) {
  return (
    <View className="relative pl-6">
      <View className="absolute bottom-1.5 left-[7px] top-1.5 w-[2px] bg-ink/[0.12]" />
      <View className="gap-6">
        {events.map((event, index) => {
          const isLatest = index === 0;

          return (
            <View key={event.key ?? index} className="relative">
              <View
                className="absolute -left-6 top-0.5 h-4 w-4 rounded-full border-[3px] border-white"
                style={{ backgroundColor: isLatest ? brand.primaryColor : palette.sand }}
              />
              <View className="flex-row items-start justify-between gap-3">
                <Text className="min-w-0 flex-1 font-hanken-bold text-[14px] text-ink">{event.title}</Text>
                <Text className="font-hanken-medium text-[12px] text-ink/60">{event.time}</Text>
              </View>
              {event.description ? (
                <Text
                  className={cn(
                    "mt-1 font-hanken text-[13px] leading-5",
                    isLatest ? "text-ink" : "text-ink/60"
                  )}
                >
                  {event.description}
                </Text>
              ) : null}
              {renderExtra ? renderExtra(event) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Foto a pantalla completa dentro de la app, con una X para cerrarla. Antes se
 * abria en el navegador y el cliente salia de la app para ver su correo.
 */
export function ImageViewer({ uri, onClose }) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={Boolean(uri)} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View className="flex-1 bg-black/95">
        {uri ? <Image source={{ uri }} style={{ flex: 1 }} contentFit="contain" transition={150} /> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close image"
          onPress={onClose}
          hitSlop={12}
          className="absolute right-4 h-10 w-10 items-center justify-center rounded-full bg-white/15 active:bg-white/30"
          style={{ top: insets.top + 12 }}
        >
          <X size={22} color="#ffffff" />
        </Pressable>
      </View>
    </Modal>
  );
}

/** Caja de datos dentro de un evento del historial (destino, tarifa...). */
export function TimelineDetails({ children }) {
  return <View className="mt-2 gap-0.5 rounded-lg border border-ink/[0.08] bg-canvas p-2.5">{children}</View>;
}

export function TimelineDetailLine({ children }) {
  return <Text className="font-hanken text-[12px] text-ink/70">{children}</Text>;
}
