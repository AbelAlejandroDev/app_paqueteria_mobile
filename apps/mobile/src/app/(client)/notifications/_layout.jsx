import { Text } from "react-native";
import { Stack } from "expo-router";

import { brand } from "@/lib/brand";

/** Titulo en la letra y el color del resto del diseño. */
function HeaderTitle({ children }) {
  return <Text className="font-hanken-bold text-[20px] tracking-tight text-ink">{children}</Text>;
}

export default function NotificationsLayout() {
  return (
    <Stack
      screenOptions={{
        headerTitleAlign: "center",
        headerTitle: (props) => <HeaderTitle {...props} />,
        headerTintColor: brand.palette.ink,
        // Mismo fondo que la lista: la cabecera no se separa del contenido.
        headerStyle: { backgroundColor: brand.palette.canvas },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: "Notifications" }} />
      <Stack.Screen name="[id]" options={{ title: "Notification" }} />
    </Stack>
  );
}
