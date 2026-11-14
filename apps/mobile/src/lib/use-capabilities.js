import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { brand } from "@/lib/brand";
import {
  BILLING_PAYMENT_QUERY_KEY,
  billingPaymentQueryKey,
  CAPABILITIES_QUERY_KEY,
  capabilitiesQueryKey,
  deriveCapabilities,
} from "@/lib/capabilities";
import { sessionScope } from "@/lib/session-scope";

export { BILLING_PAYMENT_QUERY_KEY, CAPABILITIES_QUERY_KEY };

/**
 * Cuanto se da por buena la respuesta. Es barata (sin Zoho ni Stripe): se
 * vuelve a pedir al volver a primer plano (focusManager, lib/query-focus) si
 * pasaron mas de 30 s, tras el login (la clave cambia con la sesion), tras un
 * pago y tras un 402/409 de una guarda (CapabilitiesSync).
 */
export const CAPABILITIES_STALE_MS = 30 * 1000;

export function capabilitiesQueryOptions(scope) {
  return {
    queryKey: capabilitiesQueryKey(scope),
    queryFn: async () => (await api.get("/client/capabilities")).data,
    enabled: Boolean(scope),
    staleTime: CAPABILITIES_STALE_MS,
  };
}

/**
 * GET /client/billing/payment: tarjetas, facturas y pagos (con Zoho los lee de
 * Zoho en el momento). Solo para Facturacion y la revision de un pago; las
 * decisiones salen de /client/capabilities.
 */
export function billingPaymentQueryOptions(scope, { enabled = true } = {}) {
  return {
    queryKey: billingPaymentQueryKey(scope),
    queryFn: async () => (await api.get("/client/billing/payment")).data,
    enabled: Boolean(scope) && enabled,
    staleTime: 60 * 1000,
  };
}

/** Capacidades del centro y del usuario (lib/capabilities). */
export function useCapabilities() {
  const { user } = useAuth();
  const scope = sessionScope(user);
  const query = useQuery(capabilitiesQueryOptions(scope));

  const capabilities = useMemo(
    () => deriveCapabilities({ capabilities: query.data || null, expectedTenantSlug: brand.tenantSlug }),
    [query.data]
  );

  return {
    ...capabilities,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
