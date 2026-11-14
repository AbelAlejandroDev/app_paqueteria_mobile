import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { BILLING_PAYMENT_QUERY_KEY, billingPaymentQueryKey, deriveCapabilities, PUBLIC_PORTAL_SOURCE } from "@/lib/capabilities";
import { sessionScope } from "@/lib/session-scope";

export { BILLING_PAYMENT_QUERY_KEY };

/*
 * GET /client/billing/payment lo comparten Facturacion y las capacidades: una
 * sola peticion (con Zoho, cada una consulta a Zoho).
 */

/** Cuanto se dan por buenas las capacidades antes de volver a pedirlas. */
export const CAPABILITIES_STALE_MS = 5 * 60 * 1000;

/** Opciones de la consulta, con la clave por ambito de sesion (lib/capabilities). */
export function billingPaymentQueryOptions(scope) {
  return {
    queryKey: billingPaymentQueryKey(scope),
    queryFn: async () => (await api.get("/client/billing/payment")).data,
    enabled: Boolean(scope),
    staleTime: CAPABILITIES_STALE_MS,
  };
}

/**
 * Capacidades del centro y del usuario (lib/capabilities). Se refrescan al
 * volver a primer plano si pasaron mas de CAPABILITIES_STALE_MS (focusManager,
 * lib/query-focus): los interruptores de Zoho cambian sin publicar la app.
 */
export function useCapabilities() {
  const { user } = useAuth();
  const scope = sessionScope(user);
  const billingPaymentQuery = useQuery(billingPaymentQueryOptions(scope));

  const capabilities = useMemo(
    () => deriveCapabilities({ billingPayment: billingPaymentQuery.data || null, publicPortal: null }),
    [billingPaymentQuery.data]
  );

  return {
    ...capabilities,
    isLoading: billingPaymentQuery.isLoading,
    isError: billingPaymentQuery.isError,
    error: billingPaymentQuery.error,
    refetch: billingPaymentQuery.refetch,
    publicPortalSource: PUBLIC_PORTAL_SOURCE,
  };
}
