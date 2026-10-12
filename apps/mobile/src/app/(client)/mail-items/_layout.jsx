import { Stack } from "expo-router";

import { canvasHeaderOptions } from "@/components/common/header-title";

export default function MailItemsLayout() {
  return (
    // El detalle del item pone su propia cabecera blanca con el simbolo.
    <Stack screenOptions={canvasHeaderOptions}>
      <Stack.Screen name="index" options={{ title: "Mail" }} />
      <Stack.Screen name="[id]" options={{ title: "Mail Item" }} />
    </Stack>
  );
}
