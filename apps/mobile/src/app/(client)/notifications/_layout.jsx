import { Stack } from "expo-router";

import { canvasHeaderOptions } from "@/components/common/header-title";

export default function NotificationsLayout() {
  return (
    <Stack screenOptions={canvasHeaderOptions}>
      <Stack.Screen name="index" options={{ title: "Notifications" }} />
      <Stack.Screen name="[id]" options={{ title: "Notification" }} />
    </Stack>
  );
}
