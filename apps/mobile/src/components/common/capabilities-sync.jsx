import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { subscribeCapabilitiesStale } from "@/lib/capabilities-events";
import { CAPABILITIES_QUERY_KEY } from "@/lib/use-capabilities";

/**
 * Vuelve a pedir las capacidades cuando algo dice que pueden estar viejas: un
 * 402/409 de una guarda (interceptor) o un pago terminado.
 */
export default function CapabilitiesSync() {
  const queryClient = useQueryClient();

  useEffect(
    () =>
      subscribeCapabilitiesStale(() => {
        queryClient.invalidateQueries({ queryKey: [CAPABILITIES_QUERY_KEY] });
      }),
    [queryClient]
  );

  return null;
}
