import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { notifyCapabilitiesStale } from "@/lib/capabilities-events";
import { paymentStatusMinPollMs, savedCardAllowed, zohoBillingActions } from "@/lib/capabilities";
import { formatMoneyFromCents } from "@/lib/mail-item-detail";
import { sessionScope } from "@/lib/session-scope";
import { BILLING_PAYMENT_QUERY_KEY, billingPaymentQueryOptions } from "@/lib/use-capabilities";
import { ZOHO_ADD_PAYMENT_METHOD_PATH, ZOHO_UPDATE_CARD_PATH, zohoBillingErrorMessage, zohoPageUrl } from "@/lib/zoho-billing";
import {
  confirmRepricedRatePath,
  createStatusPoller,
  interpretPrepareResponse,
  isPaymentLinkExpired,
  paymentStatusPath,
  preparePaymentError,
  preparePaymentPath,
  REVIEW_BODY,
  SAVED_CARD_BODY,
} from "@/lib/zoho-forward-payment";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/modal";

function Line({ label, value, strong }) {
  if (value === null || value === undefined) return null;
  return (
    <View className="flex-row items-center justify-between gap-3 py-0.5">
      <Text className={(strong ? "font-brand-semibold text-ink" : "font-brand text-ink/70") + " text-[14px]"}>{label}</Text>
      <Text className={(strong ? "font-brand-bold text-ink" : "font-brand text-ink/80") + " text-[14px]"}>{value}</Text>
    </View>
  );
}

/**
 * Pago de un reenvio con Zoho (lib/zoho-forward-payment).
 *
 * Pasos, todos por decision del cliente:
 *   1. "Review payment": POST prepare-payment {} (emite la factura en Zoho) y
 *      enseña el desglose. Nada se llama al abrir la pieza.
 *   2. "Pay with saved card": prepare-payment { useSavedCard: true }.
 *      autoCharge.reason decide que ofrecer si no cobro.
 *   3. "Pay on the secure page": abre paymentUrl (si caduco, otra revision
 *      primero). Al volver, payment-status cada >= 15 s, unas pocas veces, y
 *      "Check again". Solo PAID del backend da el pago por hecho.
 */
export default function ZohoForwardPaymentCard({ request, capabilities, onRefresh }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const scope = sessionScope(user);

  const [invoice, setInvoice] = useState(null); // interpretPrepareResponse(...) de kind "invoice"
  const [notice, setNotice] = useState(null);
  const [reading, setReading] = useState(null); // interpretPaymentStatus
  const [waiting, setWaiting] = useState(false);
  const [savedCardBlockedUntil, setSavedCardBlockedUntil] = useState(0);
  const [noSavedCard, setNoSavedCard] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const zohoActions = zohoBillingActions(capabilities);
  // Un numero, no el objeto: el sondeo no se rehace en cada render.
  const minPollMs = paymentStatusMinPollMs(capabilities);
  const allowSavedCard = savedCardAllowed(capabilities) && !noSavedCard && nowMs >= savedCardBlockedUntil;

  // Tarjeta guardada (last4) solo una vez en revision: billing/payment lee Zoho.
  const billingQuery = useQuery(billingPaymentQueryOptions(scope, { enabled: Boolean(invoice) }));
  const card = billingQuery.data?.zoho?.cards?.[0] || null;

  const refreshAfterPayment = useCallback(async () => {
    notifyCapabilitiesStale("payment");
    queryClient.invalidateQueries({ queryKey: [BILLING_PAYMENT_QUERY_KEY] });
    queryClient.invalidateQueries({ queryKey: ["client-payment-alerts"] });
    queryClient.invalidateQueries({ queryKey: ["client-account-alerts"] });
    queryClient.invalidateQueries({ queryKey: ["client-mail-items"] });
    await onRefresh?.();
  }, [onRefresh, queryClient]);

  // ── payment-status ──
  const pollerRef = useRef(null);
  useEffect(() => {
    const poller = createStatusPoller({
      minIntervalMs: minPollMs,
      fetchStatus: async () => (await api.get(paymentStatusPath(request.id))).data,
      onResult: ({ ok, reading: next }) => {
        if (!ok || !next) return;
        setReading(next);
        if (next.state === "paid") {
          setWaiting(false);
          refreshAfterPayment();
        } else if (next.terminal) {
          setWaiting(false);
          // La pagina caduco o el pago fallo: la proxima vez, factura/URL nuevas.
          if (next.state === "link-expired" || next.state === "failed") setInvoice(null);
        }
      },
    });
    pollerRef.current = poller;
    return () => poller.stop();
  }, [minPollMs, refreshAfterPayment, request.id]);

  useEffect(() => {
    if (!waiting) return undefined;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") pollerRef.current?.checkNow();
    });
    return () => subscription.remove();
  }, [waiting]);

  // ── prepare-payment ──
  const handlePrepareError = (error) => {
    const outcome = preparePaymentError(error);
    if (outcome.kind === "paid") {
      setNotice({ tone: "emerald", text: "This shipment is already paid." });
      refreshAfterPayment();
      return;
    }
    if (outcome.kind === "reprice") {
      Alert.alert(
        "The price changed",
        "The new total is " + formatMoneyFromCents(outcome.currentAmount) + ". Do you accept the new price?",
        [
          { text: "Not now", style: "cancel" },
          { text: "Accept new price", onPress: () => confirmReprice.mutate() },
        ]
      );
      return;
    }
    if (outcome.checkStatus) {
      setWaiting(true);
      pollerRef.current?.start();
    }
    setNotice({ tone: "amber", text: outcome.message });
  };

  const review = useMutation({
    mutationFn: async () => (await api.post(preparePaymentPath(request.id), REVIEW_BODY)).data,
    onSuccess: (data) => {
      const result = interpretPrepareResponse(data);
      if (result.kind === "paid") {
        setNotice({ tone: "emerald", text: "This shipment is already paid." });
        refreshAfterPayment();
        return;
      }
      if (result.kind !== "invoice") {
        setNotice({ tone: "amber", text: "We couldn't open the secure payment page. Please try again." });
        return;
      }
      setNotice(null);
      setReading(null);
      setInvoice(result);
    },
    onError: handlePrepareError,
  });

  const confirmReprice = useMutation({
    mutationFn: async () => (await api.post(confirmRepricedRatePath(request.id))).data,
    // Precio aceptado: se vuelve a revisar con el importe nuevo (otra accion del cliente ya hecha).
    onSuccess: () => review.mutate(),
    onError: handlePrepareError,
  });

  const payWithSavedCard = useMutation({
    mutationFn: async () => (await api.post(preparePaymentPath(request.id), SAVED_CARD_BODY)).data,
    onSuccess: (data) => {
      const result = interpretPrepareResponse(data);
      if (result.kind === "paid") {
        setInvoice(null);
        setNotice({ tone: "emerald", text: "Payment received. We're preparing your label." });
        refreshAfterPayment();
        return;
      }
      if (result.kind === "invoice") setInvoice(result);
      const outcome = result.autoCharge;
      if (outcome?.reason === "NO_SAVED_CARD") setNoSavedCard(true);
      if (outcome?.holdMs) {
        setSavedCardBlockedUntil(Date.now() + outcome.holdMs);
        setWaiting(true);
        pollerRef.current?.start();
      }
      if (outcome?.reason === "DECLINED") queryClient.invalidateQueries({ queryKey: ["client-mail-items"] });
      setNotice({ tone: "amber", text: outcome?.message || "Your saved card was not charged." });
    },
    onError: handlePrepareError,
  });

  const openSecurePage = useMutation({
    mutationFn: async () => {
      let current = invoice;
      // Una pagina caducada (o a punto) se regenera antes: misma factura, URL nueva.
      if (!current || isPaymentLinkExpired(current.expiresAt)) {
        const result = interpretPrepareResponse((await api.post(preparePaymentPath(request.id), REVIEW_BODY)).data);
        if (result.kind === "paid") return { paid: true };
        if (result.kind !== "invoice") throw new Error("INVALID_PAYMENT_URL");
        current = result;
        setInvoice(result);
      }
      await WebBrowser.openBrowserAsync(current.paymentUrl);
      return { paid: false };
    },
    onSuccess: ({ paid }) => {
      if (paid) {
        setNotice({ tone: "emerald", text: "This shipment is already paid." });
        refreshAfterPayment();
        return;
      }
      // De vuelta del navegador: la pagina no confirma nada; se pregunta al backend.
      setNotice(null);
      setReading({ state: "pending", terminal: false, message: "Checking your payment..." });
      setWaiting(true);
      pollerRef.current?.start();
    },
    onError: (error) => {
      if (error?.message === "INVALID_PAYMENT_URL") {
        setNotice({ tone: "amber", text: "We couldn't open the secure payment page. Please try again." });
        return;
      }
      handlePrepareError(error);
    },
  });

  const openZohoPage = useMutation({
    mutationFn: async (path) => {
      const url = zohoPageUrl((await api.post(path)).data);
      if (!url) throw new Error("INVALID_PAYMENT_URL");
      await WebBrowser.openBrowserAsync(url);
    },
    onSuccess: () => {
      // La tarjeta pudo cambiar: se relee, y la siguiente revision la usa.
      setNoSavedCard(false);
      queryClient.invalidateQueries({ queryKey: [BILLING_PAYMENT_QUERY_KEY] });
      notifyCapabilitiesStale("payment-method");
    },
    onError: (error) => Alert.alert("Could not open the page", zohoBillingErrorMessage(error)),
  });

  const busy =
    review.isPending || confirmReprice.isPending || payWithSavedCard.isPending || openSecurePage.isPending || openZohoPage.isPending;

  const checkAgain = () => {
    setNowMs(Date.now());
    const wait = pollerRef.current?.checkNow() || 0;
    if (wait > 0) setNotice({ tone: "amber", text: "Checking again in " + Math.ceil(wait / 1000) + " seconds." });
  };

  const breakdown = invoice?.breakdown;
  const totalLabel = useMemo(() => (breakdown?.total != null ? formatMoneyFromCents(breakdown.total) : null), [breakdown]);

  if (reading?.state === "paid") {
    return <Notice tone="emerald" className="mt-2">{reading.message}</Notice>;
  }

  return (
    <View className="mt-2 gap-2">
      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
      {reading && reading.state !== "pending" ? <Notice tone="amber">{reading.message}</Notice> : null}

      {!invoice ? (
        <>
          <Button loading={review.isPending || confirmReprice.isPending} disabled={busy || reading?.state === "review"} onPress={() => review.mutate()}>
            Review payment
          </Button>
          <Text className="font-brand text-[12px] leading-4 text-ink/60">
            You will see the total before anything is charged.
          </Text>
        </>
      ) : (
        <View className="gap-2 rounded-lg border border-border bg-background p-3">
          <Line label="Postage" value={breakdown.postage != null ? formatMoneyFromCents(breakdown.postage) : null} />
          <Line label="Handling" value={breakdown.handling != null ? formatMoneyFromCents(breakdown.handling) : null} />
          <Line label="Surcharge" value={breakdown.surcharge > 0 ? formatMoneyFromCents(breakdown.surcharge) : null} />
          <Line label="Total" value={totalLabel} strong />
          <Line label="Invoice" value={breakdown.invoiceNumber} />

          <Text className="font-brand text-[12px] leading-4 text-ink/60">
            By paying you approve this amount. The label is created only after the payment is confirmed.
          </Text>

          {allowSavedCard ? (
            <Button loading={payWithSavedCard.isPending} disabled={busy} onPress={() => payWithSavedCard.mutate()}>
              {"Pay " + (totalLabel || "") + " with saved card" + (card?.last4 ? " •••• " + card.last4 : "")}
            </Button>
          ) : null}
          <Button variant={allowSavedCard ? "outline" : "default"} loading={openSecurePage.isPending} disabled={busy} onPress={() => openSecurePage.mutate()}>
            Pay on the secure page
          </Button>

          {noSavedCard && zohoActions.addPaymentMethod ? (
            <Button variant="outline" disabled={busy} onPress={() => openZohoPage.mutate(ZOHO_ADD_PAYMENT_METHOD_PATH)}>
              Add a payment method
            </Button>
          ) : null}
          {payWithSavedCard.data?.autoCharge?.reason === "DECLINED" && zohoActions.updateCard ? (
            <Button variant="outline" disabled={busy} onPress={() => openZohoPage.mutate(ZOHO_UPDATE_CARD_PATH)}>
              Update your card
            </Button>
          ) : null}
        </View>
      )}

      {waiting || reading?.state === "pending" ? (
        <View className="gap-2">
          <Text className="font-brand text-[13px] leading-5 text-ink/70">
            {reading?.message || "We don't have a confirmation yet. It can take a minute."}
          </Text>
          <Button variant="outline" disabled={busy} onPress={checkAgain}>
            Check again
          </Button>
        </View>
      ) : null}
    </View>
  );
}
