import { Text, View } from "react-native";
import { Bell, CalendarClock, FileText, Mail, Package2, ScanLine, Store, Truck } from "lucide-react-native";

import { brand } from "@/lib/brand";
import { overWhite } from "@/lib/colors";

/**
 * Ilustraciones del tutorial, hechas con formas y los iconos de la app en los
 * colores de la marca. Nada externo: se ven sin conexion y cambian de color
 * con cada organizacion. No imitan el logo ni inventan activos de marca.
 */
const { palette } = brand;
const TINT = overWhite(palette.tint, 0.4);
const SOFT_SHADOW = {
  shadowColor: brand.palette.shadow,
  shadowOpacity: 0.1,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 3,
};

function Frame({ children, size = 236 }) {
  return (
    <View
      className="items-center justify-center rounded-full"
      style={{ width: size, height: size, backgroundColor: TINT }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {children}
    </View>
  );
}

/** Una tarjeta pequeña con icono y dos lineas, como una pieza de la bandeja. */
function MiniCard({ icon: Icon, title, subtitle, rotate = "0deg", style }) {
  return (
    <View
      className="flex-row items-center gap-2.5 rounded-2xl border border-border bg-card px-3 py-2.5"
      style={[SOFT_SHADOW, { width: 168, transform: [{ rotate }] }, style]}
    >
      <View className="h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: TINT }}>
        <Icon size={18} color={palette.glyph} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="font-brand-bold text-[13px] text-foreground" numberOfLines={1}>
          {title}
        </Text>
        <Text className="font-brand text-[11px] text-muted-foreground" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </View>
  );
}

export function MailboxIllustration() {
  return (
    <Frame>
      <MiniCard icon={Mail} title="Letter" subtitle="Received today" rotate="-5deg" style={{ marginBottom: 10 }} />
      <MiniCard icon={Package2} title="Package" subtitle="Ready to view" rotate="4deg" />
    </Frame>
  );
}

function ActionChip({ icon: Icon, label }) {
  return (
    <View className="flex-1 items-center gap-1 rounded-xl border border-border bg-card px-1 py-2">
      <Icon size={18} color={palette.glyph} />
      {/* Una sola linea: partida ("Picku p") se lee mal. */}
      <Text
        className="font-brand-semibold text-[11px] text-foreground"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {label}
      </Text>
    </View>
  );
}

export function ControlIllustration() {
  return (
    <Frame>
      <View className="gap-2 rounded-2xl border border-border bg-card p-3" style={[SOFT_SHADOW, { width: 228 }]}>
        <MiniCardHeader />
        <View className="flex-row gap-1.5">
          <ActionChip icon={Store} label="Pickup" />
          <ActionChip icon={ScanLine} label="Scan" />
          <ActionChip icon={Truck} label="Forward" />
        </View>
      </View>
    </Frame>
  );
}

function MiniCardHeader() {
  return (
    <View className="flex-row items-center gap-2">
      <View className="h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: TINT }}>
        <FileText size={14} color={palette.glyph} />
      </View>
      <View className="h-2 flex-1 rounded-full" style={{ backgroundColor: overWhite(palette.ink, 0.1) }} />
    </View>
  );
}

export function UpdatesIllustration() {
  return (
    <Frame>
      <View className="mb-3 h-16 w-16 items-center justify-center rounded-full bg-card" style={SOFT_SHADOW}>
        <Bell size={30} color={palette.glyph} />
        <View className="absolute right-3.5 top-3.5 h-3 w-3 rounded-full border-2 border-white bg-rose-600" />
      </View>
      <MiniCard icon={Mail} title="New mail received" subtitle="Tap to view" />
    </Frame>
  );
}

/** Para el paso del recorrido: las acciones de una pieza, sin poder pulsarlas. */
export function ItemActionsIllustration() {
  return (
    <View className="flex-row gap-2" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <ActionChip icon={Store} label="Pickup" />
      <ActionChip icon={ScanLine} label="Scan" />
      <ActionChip icon={Truck} label="Forward" />
    </View>
  );
}

/** Para el paso de almacenaje: un paquete con el plazo, en tono de aviso. */
export function PackageStorageIllustration() {
  return (
    <View
      className="flex-row items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View className="h-9 w-9 items-center justify-center rounded-lg bg-amber-100">
        <Package2 size={18} color="#B45309" />
      </View>
      <View className="flex-1">
        <Text className="font-brand-bold text-[13px] text-amber-900">Package</Text>
        <View className="mt-0.5 flex-row items-center gap-1">
          <CalendarClock size={12} color="#B45309" />
          <Text className="font-brand-semibold text-[11px] text-amber-900">3 free business days</Text>
        </View>
      </View>
    </View>
  );
}

export const TOUR_ILLUSTRATIONS = {
  itemActions: ItemActionsIllustration,
  packageStorage: PackageStorageIllustration,
};
