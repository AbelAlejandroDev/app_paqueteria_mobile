import { Text } from "react-native";

import { brand } from "@/lib/brand";

/** Titulo de cabecera en la letra y el color del resto del diseño. */
export function HeaderTitle({ children }) {
  return (
    <Text className="font-hanken-bold text-[20px] tracking-tight text-ink" numberOfLines={1}>
      {children}
    </Text>
  );
}

/**
 * Cabecera de las pantallas con fondo de lienzo (Mail, Notifications): mismo
 * color que el contenido, sin linea, y el titulo centrado en Hanken.
 */
export const canvasHeaderOptions = {
  headerTitleAlign: "center",
  headerTitle: (props) => <HeaderTitle {...props} />,
  headerTintColor: brand.palette.ink,
  headerStyle: { backgroundColor: brand.palette.canvas },
  headerShadowVisible: false,
};
