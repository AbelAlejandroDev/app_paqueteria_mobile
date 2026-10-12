import { View } from "react-native";
import {
  Bell,
  CreditCard,
  FileText,
  Mail,
  Megaphone,
  Package,
  Send,
  ShieldCheck,
  Store,
  Tag,
  Trash2,
} from "lucide-react-native";

import { brand } from "@/lib/brand";
import { overWhite } from "@/lib/colors";
import { notificationKind } from "@/lib/notification-kind";

const { palette } = brand;

/**
 * Icono y colores de cada familia de aviso. El verde de marca para lo que es
 * del buzon (escaneos, recogidas); el resto, un color propio para que la lista
 * se lea de un vistazo sin leer los titulos. Los fondos son opacos: en Android
 * uno translucido deja ver la sombra de la tarjeta.
 */
export const KIND_STYLES = {
  mail: { icon: Mail, color: "#D97706", background: "#FEF3E2" },
  scan: { icon: FileText, color: palette.glyph, background: overWhite(palette.tint, 0.35) },
  forward: { icon: Send, color: "#2563EB", background: "#E8F0FE" },
  label: { icon: Tag, color: "#7C3AED", background: "#F1EAFE" },
  pickup: { icon: Store, color: palette.glyph, background: overWhite(palette.tint, 0.35) },
  discard: { icon: Trash2, color: "#BE123C", background: "#FFE8EC" },
  payment: { icon: CreditCard, color: "#BE123C", background: "#FFE8EC" },
  storage: { icon: Package, color: "#D97706", background: "#FEF3E2" },
  account: { icon: ShieldCheck, color: palette.glyph, background: overWhite(palette.tint, 0.35) },
  notice: { icon: Megaphone, color: "#8C7A45", background: overWhite(palette.sand, 0.25) },
  general: { icon: Bell, color: palette.glyph, background: overWhite(palette.tint, 0.35) },
};

export function notificationStyle(notification) {
  return KIND_STYLES[notificationKind(notification)] || KIND_STYLES.general;
}

/** El cuadro con el icono del aviso. `size` es el lado del cuadro. */
export function NotificationIcon({ notification, size = 56 }) {
  const style = notificationStyle(notification);
  const Icon = style.icon;

  return (
    <View
      className="items-center justify-center"
      style={{ width: size, height: size, borderRadius: size * 0.25, backgroundColor: style.background }}
    >
      <Icon size={Math.round(size * 0.46)} color={style.color} />
    </View>
  );
}
