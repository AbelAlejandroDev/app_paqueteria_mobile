import { Stack } from "expo-router";

/**
 * Cada seccion de Settings es una ruta propia, asi que el Stack da la flecha
 * de vuelta y permite enlazar directamente a una de ellas. Los datos de cada
 * una se piden al entrar, no al abrir Settings.
 */
export default function SettingsLayout() {
  return (
    <Stack screenOptions={{ headerTitleAlign: "center" }}>
      <Stack.Screen name="index" options={{ title: "Settings" }} />
      <Stack.Screen name="forwarding-addresses" options={{ title: "Forwarding Addresses" }} />
      <Stack.Screen name="notifications" options={{ title: "Notifications" }} />
      <Stack.Screen name="authorized-individuals" options={{ title: "Authorized Individuals" }} />
      <Stack.Screen name="security" options={{ title: "Security" }} />
    </Stack>
  );
}
