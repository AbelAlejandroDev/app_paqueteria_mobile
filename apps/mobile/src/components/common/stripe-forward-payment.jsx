import { useCallback, useState } from "react";
import { Alert, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as ExpoLinking from "expo-linking";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { notifyCapabilitiesStale } from "@/lib/capabilities-events";
import { paymentStatusMinPollMs } from "@/lib/capabilities";
import { confirmRepricedRatePath, createSingleFlight, forwardPaymentError, paymentStatusPath } from "@/lib/forward-payment";
import { formatMoneyFromCents } from "@/lib/mail-item-detail";
import { stripeReturnBody } from "@/lib/stripe-return";
import { ACTION_NONE, ACTION_RESUME, busyDeadline, isStillBusy, stripePaymentDecision } from "@/lib/stripe-payment-guard";
import { startStripeCheckout } from "@/lib/stripe-checkout-flow";
import { BILLING_PAYMENT_QUERY_KEY } from "@/lib/use-capabilities";
import { usePaymentStatus } from "@/lib/use-payment-status";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/modal";

export const FORWARD_PAYMENT_STATUS_KEY = "forward-payment-status";

/**
 * Pago de un reenvio con Stripe (The Worx): el Checkout alojado de Stripe (POST
 * checkout-session), protegido contra cobros dobles (lib/stripe-payment-guard).
 *
 *   - Cada pulsacion lee payment-status JUSTO ANTES del POST y decide con lo que
 *     dice el servidor (canStartNewPayment con el backend nuevo; con el anterior,
 *     un PAYMENT_PENDING sin confirmar bloquea). El candado evita la doble
 *     pulsacion; el boton no es la proteccion.
 *   - Una sesion abierta se continua (el backend devuelve la misma: 200,
 *     reused) en vez de crear otra.
 *   - 409 BUSY: se espera Retry-After antes de ofrecerlo otra vez; PROCESSING,
 *     UNCERTAIN o sin respuesta: se comprueba el estado, no se paga otra vez;
 *     NEEDS_REVIEW: lo revisa el centro. Nunca se repite un pago solo.
 *   - Recotizacion: el importe nuevo solo se acepta con confirmacion explicita
 *     (confirm-repriced-rate) y pagar sigue siendo otra pulsacion.
 */
export default function StripeForwardPayment({ request, mailItemId, capabilities, onRefresh }) {
  const queryClient = useQueryClient();
  const details = request.forwardDetails || {};
  const needsAuthentication = details.paymentStatus === "AUTHENTICATION_REQUIRED";
  const [lock] = useState(createSingleFlight);
  const [notice, setNotice] = useState(null);
  const [confirmedAmount, setConfirmedAmount] = useState(null);
  const [busyUntil, setBusyUntil] = useState(0);
  const [starting, setStarting] = useState(false);

  const statusKey = [FORWARD_PAYMENT_STATUS_KEY, request.id];
  // Lectura del estado al abrir la pieza: solo lee (GET), no cobra nada.
  const statusQuery = useQuery({
    queryKey: statusKey,
    queryFn: async () => (await api.get(paymentStatusPath(request.id))).data,
    staleTime: 0,
  });

  const refreshAfterPayment = useCallback(async () => {
    notifyCapabilitiesStale("payment");
    queryClient.invalidateQueries({ queryKey: [BILLING_PAYMENT_QUERY_KEY] });
    queryClient.invalidateQueries({ queryKey: ["client-payment-alerts"] });
    queryClient.invalidateQueries({ queryKey: ["client-account-alerts"] });
    queryClient.invalidateQueries({ queryKey: ["client-mail-items"] });
    await onRefresh?.();
  }, [onRefresh, queryClient]);

  const status = usePaymentStatus({
    serviceRequestId: request.id,
    minPollMs: paymentStatusMinPollMs(capabilities),
    onResult: ({ ok, status: latest, reading }) => {
      if (ok && latest) queryClient.setQueryData(statusKey, latest);
      if (reading?.terminal) refreshAfterPayment();
    },
  });

  const decision = stripePaymentDecision(statusQuery.data, { localPaymentStatus: details.paymentStatus });

  const handleError = (error) => {
    const outcome = forwardPaymentError(error);
    if (outcome.kind === "paid") {
      setNotice({ tone: "emerald", text: "This shipment is already paid." });
      refreshAfterPayment();
      return;
    }
    if (outcome.kind === "reprice" && outcome.currentAmount === null) {
      setNotice({ tone: "amber", text: "The shipping price changed. Pull down to refresh, then try again." });
      onRefresh?.();
      return;
    }
    if (outcome.kind === "reprice") {
      Alert.alert(
        "The price changed",
        "The new total is " + formatMoneyFromCents(outcome.currentAmount) + ". Do you accept the new price?",
        [
          { text: "Not now", style: "cancel" },
          { text: "Accept new price", onPress: () => lock.run(() => confirmReprice.mutateAsync(outcome.currentAmount).catch(() => {})) },
        ]
      );
      return;
    }
    if (outcome.kind === "busy") {
      // Se espera lo que dice el servidor; no se vuelve a intentar solo.
      setBusyUntil(busyDeadline(outcome.retryAfterSeconds));
      setNotice({ tone: "amber", text: "This payment is already being prepared. Try again in " + (outcome.retryAfterSeconds || 3) + " seconds." });
      return;
    }
    if (outcome.checkStatus) status.start();
    if (outcome.kind === "unavailable") notifyCapabilitiesStale("payment-unavailable");
    queryClient.invalidateQueries({ queryKey: statusKey });
    setNotice({ tone: "amber", text: outcome.message });
  };

  const checkout = useMutation({
    mutationFn: async () => {
      // A Stripe no se le manda el deep link (lib/stripe-return): vuelve al portal
      // web del centro por https, siempre la misma URL (asi el backend reutiliza
      // la sesion abierta en vez de crear otra).
      const returnUrl = ExpoLinking.createURL("/mail-items/" + mailItemId);
      // Estado recien leido -> decision -> POST checkout-session
      // (lib/stripe-checkout-flow). Si el servidor no deja pagar, no hay POST.
      const result = await startStripeCheckout(api, {
        serviceRequestId: request.id,
        localPaymentStatus: details.paymentStatus,
        body: stripeReturnBody({ successUrl: returnUrl, cancelUrl: returnUrl }),
      });
      if (result.status) queryClient.setQueryData(statusKey, result.status);
      if (result.outcome === "status-unavailable") return { blocked: { message: "We couldn't check the payment status. Nothing was charged; try again when you're back online." } };
      if (result.outcome === "blocked") return { blocked: result.decision };
      const session = result.session;
      if (!session.url) throw new Error("Stripe did not return a payment URL.");
      if (session.expired) return { expired: true };
      await WebBrowser.openAuthSessionAsync(session.url, returnUrl);
      return { expired: false, reused: session.reused };
    },
    onSuccess: ({ expired, blocked }) => {
      if (blocked) {
        setNotice({ tone: blocked.paid ? "emerald" : "amber", text: blocked.message });
        if (blocked.paid) refreshAfterPayment();
        else if (blocked.checkStatus) status.start();
        return;
      }
      setConfirmedAmount(null);
      setNotice(expired ? { tone: "amber", text: "The payment page had expired. Checking the status before you try again." } : null);
      // De vuelta (pagara o no): solo el backend sabe si se cobro.
      status.start();
      onRefresh?.();
    },
    onError: (error) => {
      if (!error?.response && /payment URL/.test(String(error?.message))) {
        setNotice({ tone: "amber", text: "We couldn't open the secure payment page. Please try again." });
        return;
      }
      handleError(error);
    },
  });

  const confirmReprice = useMutation({
    mutationFn: async () => (await api.post(confirmRepricedRatePath(request.id))).data,
    onSuccess: (data, acceptedAmount) => {
      const amount = Number(data?.amount ?? acceptedAmount);
      setConfirmedAmount(Number.isFinite(amount) ? amount : null);
      setNotice({
        tone: "emerald",
        text: "New price confirmed" + (Number.isFinite(amount) ? ": " + formatMoneyFromCents(amount) : "") + ". Tap Pay now to continue.",
      });
      queryClient.invalidateQueries({ queryKey: statusKey });
      onRefresh?.();
    },
    onError: handleError,
  });

  /**
   * Comprobacion previa: el estado del servidor recien leido decide si se inicia
   * (o continua) el pago. Sin respuesta, no se paga.
   */
  /**
   * Una pulsacion: el candado contra la doble pulsacion, la espera de un 409 BUSY
   * y la mutacion, que lee el estado del servidor antes de cualquier POST.
   */
  const startPayment = () =>
    lock.run(async () => {
      if (isStillBusy(busyUntil)) {
        setNotice({ tone: "amber", text: "This payment is already being prepared. Try again in a few seconds." });
        return;
      }
      setStarting(true);
      try {
        await checkout.mutateAsync().catch(() => {});
      } finally {
        setStarting(false);
      }
    });

  const checkAgain = () => {
    const wait = status.checkNow();
    if (wait > 0) setNotice({ tone: "amber", text: "Checking again in " + Math.ceil(wait / 1000) + " seconds." });
  };

  const reading = status.reading;
  if (reading?.state === "paid" || decision.paid) {
    return (
      <Notice tone="emerald" className="mt-2">
        {reading?.message || decision.message}
      </Notice>
    );
  }

  const busy = starting || checkout.isPending || confirmReprice.isPending;
  const canOffer = decision.action !== ACTION_NONE && !status.waiting;
  const label =
    decision.action === ACTION_RESUME
      ? "Continue payment"
      : needsAuthentication || reading?.authentication
        ? "Verify and pay"
        : "Pay " + (confirmedAmount != null ? formatMoneyFromCents(confirmedAmount) + " " : "") + "now";

  return (
    <View className="mt-2 gap-2">
      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
      {!notice && reading && reading.state !== "pending" ? <Notice tone="amber">{reading.message}</Notice> : null}
      {!notice && !reading && decision.action === ACTION_NONE && decision.message ? (
        <Notice tone="amber">{decision.message}</Notice>
      ) : null}

      {statusQuery.isLoading ? (
        <Button className="mt-1" loading disabled>
          Pay now
        </Button>
      ) : canOffer ? (
        <>
          <Button className="mt-1" loading={busy} disabled={busy} onPress={startPayment}>
            {label}
          </Button>
          <Text className="font-brand text-[12px] leading-4 text-ink/60">
            Payment opens in a secure Stripe page. It can take a moment to show as paid here.
          </Text>
        </>
      ) : null}

      {status.waiting || decision.checkStatus || statusQuery.isError ? (
        <View className="gap-2">
          {status.waiting ? (
            <Text className="font-brand text-[13px] leading-5 text-ink/70">{reading?.message || "Checking your payment..."}</Text>
          ) : null}
          <Button variant="outline" disabled={busy} onPress={statusQuery.isError ? () => statusQuery.refetch() : checkAgain}>
            Check payment status
          </Button>
        </View>
      ) : null}

      {decision.contactCenter ? (
        <Text className="font-brand text-[12px] leading-4 text-ink/60">
          If this doesn&apos;t update, contact your center. Don&apos;t pay again until it&apos;s confirmed.
        </Text>
      ) : null}
    </View>
  );
}
