import { RefreshControl, ScrollView } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import FeeScheduleView, { FEE_SCHEDULE_QUERY_KEY } from "@/components/common/fee-schedule";

/**
 * El Fee Schedule del centro del cliente, el mismo que la pestaña "Fees" de
 * Billing (mismo componente y misma cache), para encontrarlo tambien desde
 * Settings junto a los Terms & Conditions.
 */
export default function FeeScheduleScreen() {
  const queryClient = useQueryClient();

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-24"
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={() => queryClient.invalidateQueries({ queryKey: FEE_SCHEDULE_QUERY_KEY })}
        />
      }
    >
      <FeeScheduleView />
    </ScrollView>
  );
}
