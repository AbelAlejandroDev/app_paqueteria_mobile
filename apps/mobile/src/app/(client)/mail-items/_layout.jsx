import { Stack } from "expo-router";

export default function MailItemsLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "Mail Items" }} />
      <Stack.Screen name="[id]" options={{ title: "Mail Item" }} />
    </Stack>
  );
}
