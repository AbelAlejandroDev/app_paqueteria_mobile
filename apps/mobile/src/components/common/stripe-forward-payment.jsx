import { useCallback, useState } from "react";
import { Alert, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as ExpoLinking from "expo-linking";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { notifyCapabilitiesStale } from "@/lib/capabilities-events";
import { paymentStatusMinPollMs } from "@/lib/capabilities";
import {
  confirmRepricedRatePath,
  createSingleFlight,
  forwardPaymentError,
  isPaymentInFlight,
} from "@/lib/forward-payment";
import { formatMoneyFromCents } from "@/lib/mail-item-detail";
import { stripeReturnBody } from "@/lib/stripe-return";
import { BILLING_PAYMENT_QUERY_KEY } from "@/lib/use-capabilities";
import { usePaymentStatus } from "@/lib/use-payment-status";
import { isSecurePageUrl } from "@/lib/zoho-billing";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/modal";

const TERMINAL_NO_PAY = ["paid", "cancelled", "refunded", "review"];

/**
 * Pago de un reenvio con Stripe (The Worx): el Checkout alojado de Stripe de
 * siempre (POST checkout-session), con lo que faltaba alrededor:
 *
 *   - Recotizacion: si el precio subio (409 + reprice), el cliente ve el
 *     importe nuevo y solo si acepta se llama a confirm-repriced-rate; despues
 *     vuelve a pulsar "Pay now". Nada se paga sin esa segunda pulsacion.
 *   - Vuelta del navegador: payment-status (lo guardado; lo actualiza el webhook)
 *     cada >= 15 s, unas pocas veces, y "Check payment status".
 *   - Dobles cobros: un candado contra la doble pulsacion y, si ya hay un pago
 *     empezado sin confirmar (PAYMENT_PENDING), pagar otra vez pide confirmacion:
 *     abrir otro Checkout cancela el anterior solo "si se puede".
 */
export default function StripeForwardPayment({ request, mailItemId, capabilities, onRefresh }) {
  const queryClient = useQueryClient();
  const details = request.forwardDetails || {};
  const needsAuthentication = details.paymentStatus === "AUTHENTICATION_REQUIRED";
  const [lock] = useState(createSingleFlight);
  const [notice, setNotice] = useState(null);
  const [confirmedAmount, setConfirmedAmount] = useState(null);

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
    onResult: ({ reading }) => {
      if (reading?.terminal) refreshAfterPayment();
    },
  });

  const handleError = (error) => {
    const outcome = forwardPaymentError(error);
    if (outcome.kind === "paid") {
      setNotice({ tone: "emerald", text: "This shipment is already paid." });
      refreshAfterPayment();
      return;
    }
    if (outcome.kind === "reprice" && outcome.currentAmount === null) {
      // Sin el importe nuevo no se puede aceptar a ciegas.
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
    if (outcome.checkStatus) status.start();
    if (outcome.kind === "unavailable") notifyCapabilitiesStale("payment-unavailable");
    setNotice({ tone: "amber", text: outcome.message });
  };

  const pay = useMutation({
    mutationFn: async () => {
      // La misma URL para las dos salidas: la app no distingue entre pagar y
      // desistir. A Stripe no se le manda el deep link (lib/stripe-return):
      // vuelve al portal web del centro por https.
      const returnUrl = ExpoLinking.createURL("/mail-items/" + mailItemId);
      const response = await api.post(
        "/client/forwarding/" + request.id + "/checkout-session",
        stripeReturnBody({ successUrl: returnUrl, cancelUrl: returnUrl })
      );

      const url = response.data?.url;
      if (!isSecurePageUrl(url)) throw new Error("Stripe did not return a payment URL.");

      return WebBrowser.openAuthSessionAsync(url, returnUrl);
    },
    onSuccess: () => {
      // De vuelta (pagara o no): solo el backend sabe si se cobro.
      setNotice(null);
      setConfirmedAmount(null);
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
      onRefresh?.();
    },
    onError: handleError,
  });

  const busy = pay.isPending || confirmReprice.isPending;
  const reading = status.reading;
  const inFlight = isPaymentInFlight(details.paymentStatus) || reading?.state === "pending";

  const startPayment = () => {
    const go = () => lock.run(() => pay.mutateAsync().catch(() => {}));
    if (!inFlight) return go();
    // Un pago empezado y sin confirmar: otro Checkout podria cobrar dos veces.
    Alert.alert(
      "A payment may already be in progress",
      "If you completed the payment, it can take a moment to show here. Paying again could charge you twice.",
      [
        { text: "Check status", style: "cancel", onPress: () => status.checkNow() },
        { text: "Pay again", style: "destructive", onPress: go },
      ]
    );
    return null;
  };

  const checkAgain = () => {
    const wait = status.checkNow();
    if (wait > 0) setNotice({ tone: "amber", text: "Checking again in " + Math.ceil(wait / 1000) + " seconds." });
  };

  if (reading?.state === "paid") {
    return (
      <Notice tone="emerald" className="mt-2">
        {reading.message}
      </Notice>
    );
  }

  const canPay = !TERMINAL_NO_PAY.includes(reading?.state);

  return (
    <View className="mt-2 gap-2">
      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
      {reading && reading.state !== "pending" ? <Notice tone="amber">{reading.message}</Notice> : null}
      {!reading && isPaymentInFlight(details.paymentStatus) ? (
        <Notice tone="amber">A payment was started for this shipment. Check its status before paying again.</Notice>
      ) : null}

      {canPay ? (
        <>
          <Button className="mt-1" loading={busy} disabled={busy || status.waiting} onPress={startPayment}>
            {needsAuthentication || reading?.authentication
              ? "Verify and pay"
              : "Pay " + (confirmedAmount != null ? formatMoneyFromCents(confirmedAmount) + " " : "") + "now"}
          </Button>
          <Text className="font-brand text-[12px] leading-4 text-ink/60">
            Payment opens in a secure Stripe page. It can take a moment to show as paid here.
          </Text>
        </>
      ) : null}

      {status.waiting || inFlight ? (
        <View className="gap-2">
          {status.waiting ? (
            <Text className="font-brand text-[13px] leading-5 text-ink/70">
              {reading?.message || "Checking your payment..."}
            </Text>
          ) : null}
          <Button variant="outline" disabled={busy} onPress={checkAgain}>
            Check payment status
          </Button>
        </View>
      ) : null}
    </View>
  );
}

