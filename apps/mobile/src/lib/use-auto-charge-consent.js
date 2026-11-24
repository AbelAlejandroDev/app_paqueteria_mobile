import { Platform } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { brand } from "@/lib/brand";
import { sessionScope } from "@/lib/session-scope";
import {
  AUTO_CHARGE_CONSENT_PATH,
  AUTO_CHARGE_CONSENT_QUERY_KEY,
  autoChargeConsentEnabled,
  consentPlatformHeaders,
  describeConsent,
  grantConsentBody,
  REVOKE_CONSENT_BODY,
  staffChargeDecision,
} from "@/lib/auto-charge-consent";
import { FORWARD_PAYMENT_ZOHO_HOSTED } from "@/lib/capabilities";
import { isStaffPreparedForward } from "@/lib/forward-form";

/**
 * Si un reenvio pendiente de pago lo cobra el centro (lib/auto-charge-consent,
 * staffChargeDecision) o sigue el pago manual.
 *
 * Solo consulta algo para cartas y sobres grandes con Zoho en READY_FOR_PAYMENT:
 * la autorizacion y el Mail Forwarding Fee (immediate-preview, la misma cache
 * que la hoja de reenvio). PACKAGE y Stripe (The Worx) no piden nada y quedan
 * en "manual".
 *
 * `loading`: aun no se sabe; quien lo usa no ensena Review & Pay ni el aviso
 * del centro hasta saberlo. Un error en cualquiera de las dos consultas deja el
 * pago manual (el contrato: sin total, Review & Pay).
 */
export function useStaffChargeDecision({ request, itemType, paymentMode }) {
  const details = request?.forwardDetails || null;
  const staffPrepared = isStaffPreparedForward(itemType);
  const relevant = Boolean(details) && staffPrepared && paymentMode === FORWARD_PAYMENT_ZOHO_HOSTED && details.paymentStatus === "READY_FOR_PAYMENT";

  const autoCharge = useAutoChargeConsent({ enabled: relevant });
  const active = relevant && autoCharge.enabled;

  const feeQuery = useQuery({
    queryKey: ["client-forward-immediate-preview"],
    queryFn: async () => (await api.get("/client/forwarding/immediate-preview")).data,
    enabled: active && autoCharge.consent.valid,
  });

  if (!active) return { staffPrepared, loading: false, decision: { mode: "manual", reason: relevant ? "NOT_OFFERED" : "NOT_RELEVANT" } };
  if (autoCharge.query.isLoading) return { staffPrepared, loading: true, decision: null };
  if (!autoCharge.consent.valid) return { staffPrepared, loading: false, decision: { mode: "manual", reason: "NOT_AUTHORIZED" } };
  if (feeQuery.isLoading) return { staffPrepared, loading: true, decision: null };

  const feeCents = feeQuery.isSuccess ? feeQuery.data?.immediateForwardFeeCents : null;
  return {
    staffPrepared,
    loading: false,
    decision: staffChargeDecision({ itemType, details, consent: autoCharge.consent, feeCents: typeof feeCents === "number" ? feeCents : null }),
  };
}

export function autoChargeConsentQueryKey(scope) {
  return [AUTO_CHARGE_CONSENT_QUERY_KEY, scope];
}

/**
 * GET/PUT de la autorizacion de cobro automatico (lib/auto-charge-consent).
 *
 * Solo en la marca que la tiene y para su organizacion: en The Worx `enabled`
 * es false y no se hace ninguna peticion. La cache solo guarda lo que
 * devolvio la API (GET o PUT): nunca una aceptacion que no confirmo.
 */
export function useAutoChargeConsent({ enabled: wanted = true } = {}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const scope = sessionScope(user);
  const enabled = Boolean(scope) && autoChargeConsentEnabled(user?.tenant?.slug, brand);
  const queryKey = autoChargeConsentQueryKey(scope);

  const query = useQuery({
    queryKey,
    queryFn: async () => (await api.get(AUTO_CHARGE_CONSENT_PATH)).data,
    enabled: enabled && wanted,
    staleTime: 30 * 1000,
  });

  const headers = consentPlatformHeaders(Platform.OS);
  const store = (data) => {
    queryClient.setQueryData(queryKey, data);
    return describeConsent(data);
  };

  /** Alta con la oferta mostrada; devuelve describeConsent de la respuesta. */
  const grant = useMutation({
    mutationFn: async (offer) => (await api.put(AUTO_CHARGE_CONSENT_PATH, grantConsentBody(offer), { headers })).data,
    onSuccess: store,
    onError: () => queryClient.invalidateQueries({ queryKey }),
  });

  const revoke = useMutation({
    mutationFn: async () => (await api.put(AUTO_CHARGE_CONSENT_PATH, REVOKE_CONSENT_BODY, { headers })).data,
    onSuccess: store,
    onError: () => queryClient.invalidateQueries({ queryKey }),
  });

  return {
    enabled,
    query,
    consent: describeConsent(query.data),
    grant,
    revoke,
  };
}
