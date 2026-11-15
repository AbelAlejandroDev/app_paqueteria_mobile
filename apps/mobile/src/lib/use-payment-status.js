import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { api } from "@/lib/api";
import { createStatusPoller, paymentStatusPath } from "@/lib/forward-payment";

/**
 * Seguimiento de GET payment-status de un reenvio (Stripe o Zoho), con el
 * sondeo de lib/forward-payment: como mucho cada `minPollMs` (>= 15 s), unas
 * pocas veces, al volver a primer plano y con "Check again". Solo lee.
 *
 * `onResult(result)` recibe cada lectura (`result.reading` de
 * interpretPaymentStatus); quien lo usa decide que refrescar al confirmarse.
 */
export function usePaymentStatus({ serviceRequestId, minPollMs, onResult }) {
  const [reading, setReading] = useState(null);
  const [waiting, setWaiting] = useState(false);
  const pollerRef = useRef(null);
  const onResultRef = useRef(onResult);

  useEffect(() => {
    onResultRef.current = onResult;
  });

  useEffect(() => {
    const poller = createStatusPoller({
      minIntervalMs: minPollMs,
      fetchStatus: async () => (await api.get(paymentStatusPath(serviceRequestId))).data,
      onResult: (result) => {
        if (result.ok && result.reading) setReading(result.reading);
        if (result.reading?.terminal || result.exhausted) setWaiting(false);
        onResultRef.current?.(result);
      },
    });
    pollerRef.current = poller;
    return () => poller.stop();
  }, [minPollMs, serviceRequestId]);

  useEffect(() => {
    if (!waiting) return undefined;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") pollerRef.current?.checkNow();
    });
    return () => subscription.remove();
  }, [waiting]);

  /** Tras volver del pago: una tanda de comprobaciones. */
  const start = useCallback(() => {
    setWaiting(true);
    setReading({ state: "pending", terminal: false, message: "Checking your payment..." });
    pollerRef.current?.start();
  }, []);

  /** "Check again": devuelve los ms que faltan si es pronto. */
  const checkNow = useCallback(() => {
    setWaiting(true);
    return pollerRef.current?.checkNow() || 0;
  }, []);

  return { reading, waiting, start, checkNow, setReading };
}
