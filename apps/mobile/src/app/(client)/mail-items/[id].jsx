import { useLocalSearchParams } from "expo-router";

import PendingScreen from "@/components/pending-screen";

export default function MailItemDetailScreen() {
  const { id } = useLocalSearchParams();

  return (
    <PendingScreen
      title={`Mail Item ${id ?? ""}`.trim()}
      source="src/pages/client/ClientMailItemDetailPage.jsx (1356 líneas)"
    />
  );
}
