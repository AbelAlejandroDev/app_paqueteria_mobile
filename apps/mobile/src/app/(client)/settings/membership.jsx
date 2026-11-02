import { RefreshControl, ScrollView } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import MembershipCancellation from "@/components/common/membership-cancellation";

/**
 * Cancel Membership desde Settings: el mismo componente (y la misma cache) que
 * la pestaña Payment de Billing, que sigue estando alli. La regla de los 15
 * dias y las fechas las manda el servidor.
 */
export default function MembershipScreen() {
  const queryClient = useQueryClient();

  return (
    <ScrollView
      className="flex-1 bg-canvas"
      contentContainerClassName="gap-4 p-4 pb-24"
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={() => queryClient.invalidateQueries({ queryKey: ["client-membership-cancellation"] })}
        />
      }
    >
      <MembershipCancellation />
    </ScrollView>
  );
}
