import { Stack } from "expo-router";

import { canvasHeaderOptions } from "@/components/common/header-title";

/**
 * Help tiene su propio Stack, como Settings: Terms & Conditions y Fee Schedule
 * se abren desde aqui y la flecha de vuelta regresa a Help, no a Settings.
 */
export default function HelpLayout() {
  return (
    <Stack screenOptions={canvasHeaderOptions}>
      <Stack.Screen name="index" options={{ title: "Help" }} />
      <Stack.Screen name="terms" options={{ title: "Terms & Conditions" }} />
      <Stack.Screen name="fee-schedule" options={{ title: "Fee Schedule" }} />
    </Stack>
  );
}
