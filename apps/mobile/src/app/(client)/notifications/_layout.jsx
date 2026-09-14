import { Stack } from "expo-router";

export default function NotificationsLayout() {
  return (
    <Stack screenOptions={{ headerTitleAlign: "center" }}>
      <Stack.Screen name="index" options={{ title: "Notifications" }} />
      <Stack.Screen name="[id]" options={{ title: "Notification" }} />
    </Stack>
  );
}
