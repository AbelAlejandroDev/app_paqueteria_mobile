import { Text, View } from "react-native";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";

import { sandboxIndicator } from "@/lib/environment-indicator";

/**
 * Franja permanente de "Sandbox" arriba de todo, cuando la build o el servidor
 * son de pruebas (lib/environment-indicator).
 *
 * La franja ocupa la zona de la barra de estado; lo de debajo recibe el inset
 * superior a 0 para que las cabeceras no vuelvan a dejar ese hueco.
 */
export default function SandboxFrame({ apiEnvironment, deployment, children }) {
  const insets = useSafeAreaInsets();
  const indicator = sandboxIndicator({ apiEnvironment, deployment });

  if (!indicator.visible) return children;

  return (
    <View style={{ flex: 1 }}>
      <View
        accessibilityRole="text"
        accessibilityLabel={indicator.label}
        style={{ paddingTop: insets.top, backgroundColor: indicator.mismatch ? "#B91C1C" : "#B45309" }}
      >
        <Text className="px-4 py-1 text-center font-brand-semibold text-[12px] text-white">{indicator.label}</Text>
      </View>
      <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>{children}</SafeAreaInsetsContext.Provider>
    </View>
  );
}
