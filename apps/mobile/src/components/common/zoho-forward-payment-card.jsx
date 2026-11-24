import { useCallback, useMemo, useState } from "react";
import { Alert, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { notifyCapabilitiesStale } from "@/lib/capabilities-events";
import { paymentStatusMinPollMs, savedCardAllowed, zohoBillingActions } from "@/lib/capabilities";
import {
  confirmRepricedRatePath,
  createSingleFlight,
  forwardPaymentError,
  isQuoteBlocked,
  paymentRateKey,
  preparePaymentPath,
  QUOTE_INVALID_PAYMENT_MESSAGE,
} from "@/lib/forward-payment";
import { formatMoneyFromCents } from "@/lib/mail-item-detail";
import { sessionScope } from "@/lib/session-scope";
import { BILLING_PAYMENT_QUERY_KEY, billingPaymentQueryOptions } from "@/lib/use-capabilities";
import { usePaymentStatus } from "@/lib/use-payment-status";
import { ZOHO_ADD_PAYMENT_METHOD_PATH, ZOHO_UPDATE_CARD_PATH, zohoBillingErrorMessage, zohoPageUrl } from "@/lib/zoho-billing";
import { interpretPrepareResponse, isPaymentLinkExpired, REVIEW_BODY, SAVED_CARD_BODY } from "@/lib/zoho-forward-payment";
import { chargeRows } from "@/lib/price-display";
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
 * Pago de un reenvio con Zoho (lib/zoho-forward-payment; lo comun con Stripe en
 * lib/forward-payment y lib/use-payment-status).
 *
 * Pasos, todos por decision del cliente:
 *   1. "Review payment": POST prepare-payment {} (emite la factura en Zoho) y
 *      enseña el desglose. Nada se llama al abrir la pieza.
 *   2. "Pay with saved card": prepare-payment { useSavedCard: true }.
 *      autoCharge.reason decide que ofrecer si no cobro.
 *   3. "Pay on the secure page": abre paymentUrl (si caduco, otra revision
 *      primero). Al volver, payment-status cada >= 15 s, unas pocas veces, y
 *      "Check again". Solo PAID del backend da el pago por hecho.
 *
 * Un candado (createSingleFlight) impide que una doble pulsacion mande dos POST.
 */
export default function ZohoForwardPaymentCard({ request, capabilities, onRefresh }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const scope = sessionScope(user);
  const [lock] = useState(createSingleFlight);

  const [invoice, setInvoice] = useState(null); // interpretPrepareResponse(...) de kind "invoice"
  const [notice, setNotice] = useState(null);
  const [savedCardBlockedUntil, setSavedCardBlockedUntil] = useState(0);
  const [noSavedCard, setNoSavedCard] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // 409 de cotizacion invalida: se descarta la factura revisada y no se ofrece
  // pagar hasta que la solicitud traiga otra tarifa (lib/forward-payment).
  const [invalidQuoteKey, setInvalidQuoteKey] = useState(null);
  const quoteBlocked = isQuoteBlocked(invalidQuoteKey, request);

  const zohoActions = zohoBillingActions(capabilities);
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

  const status = usePaymentStatus({
    serviceRequestId: request.id,
    minPollMs: paymentStatusMinPollMs(capabilities),
    onResult: ({ reading }) => {
      if (!reading) return;
      if (reading.state === "paid") refreshAfterPayment();
      // La pagina caduco o el pago fallo: la proxima vez, factura/URL nuevas.
      if (reading.state === "link-expired" || reading.state === "failed") setInvoice(null);
    },
  });

  const guarded = (mutation, variables) => lock.run(() => (quoteBlocked ? Promise.resolve() : mutation.mutateAsync(variables).catch(() => {})));

  // ── prepare-payment ──
  const handlePrepareError = (error) => {
    const outcome = forwardPaymentError(error);
    if (outcome.kind === "quote-invalid") {
      // Sin reintento: fuera la factura y la tarifa; se recarga la solicitud.
      setInvalidQuoteKey(paymentRateKey(request));
      setInvoice(null);
      setNotice(null);
      onRefresh?.();
      return;
    }
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
          { text: "Accept new price", onPress: () => guarded(confirmReprice) },
        ]
      );
      return;
    }
    if (outcome.checkStatus) status.start();
    if (outcome.kind === "unavailable") notifyCapabilitiesStale("payment-unavailable");
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
      status.setReading(null);
      setInvoice(result);
    },
    onError: handlePrepareError,
  });

  const confirmReprice = useMutation({
    mutationFn: async () => (await api.post(confirmRepricedRatePath(request.id))).data,
    // Precio aceptado: se vuelve a revisar con el importe nuevo. Revisar no
    // cobra; pagar sigue necesitando otra pulsacion.
    onSuccess: () => {
      setInvoice(null);
      setNotice({ tone: "emerald", text: "New price confirmed. Review the payment to continue." });
    },
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
      if (outcome?.reason === "DECLINED") {
        setDeclined(true);
        queryClient.invalidateQueries({ queryKey: ["client-mail-items"] });
      }
      if (outcome?.holdMs) {
        setSavedCardBlockedUntil(Date.now() + outcome.holdMs);
        status.start();
      }
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
      status.start();
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
      setDeclined(false);
      queryClient.invalidateQueries({ queryKey: [BILLING_PAYMENT_QUERY_KEY] });
      notifyCapabilitiesStale("payment-method");
    },
    onError: (error) => Alert.alert("Could not open the page", zohoBillingErrorMessage(error)),
  });

  const busy =
    review.isPending || confirmReprice.isPending || payWithSavedCard.isPending || openSecurePage.isPending || openZohoPage.isPending;

  const checkAgain = () => {
    setNowMs(Date.now());
    const wait = status.checkNow();
    if (wait > 0) setNotice({ tone: "amber", text: "Checking again in " + Math.ceil(wait / 1000) + " seconds." });
  };

  const reading = status.reading;
  const breakdown = invoice?.breakdown;
  const totalLabel = useMemo(() => (breakdown?.total != null ? formatMoneyFromCents(breakdown.total) : null), [breakdown]);

  if (reading?.state === "paid") {
    return (
      <Notice tone="emerald" className="mt-2">
        {reading.message}
      </Notice>
    );
  }

  const blocked = quoteBlocked || ["review", "cancelled", "refunded"].includes(reading?.state);

  return (
    <View className="mt-2 gap-2">
      {quoteBlocked ? <Notice tone="amber">{QUOTE_INVALID_PAYMENT_MESSAGE}</Notice> : null}
      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
      {reading && reading.state !== "pending" ? <Notice tone="amber">{reading.message}</Notice> : null}

      {blocked ? null : !invoice ? (
        <>
          <Button loading={review.isPending || confirmReprice.isPending} disabled={busy || status.waiting} onPress={() => guarded(review)}>
            Review payment
          </Button>
          <Text className="font-brand text-[12px] leading-4 text-ink/60">You will see the total before anything is charged.</Text>
        </>
      ) : (
        <View className="gap-2 rounded-lg border border-border bg-background p-3">
          {/* Tres lineas (lib/price-display): la gestion interna va dentro de
              Shipping & Handling y nunca se ensena sola. */}
          {chargeRows(breakdown).map((row) => (
            <Line
              key={row.label}
              label={row.label}
              value={row.cents != null ? formatMoneyFromCents(row.cents) : "Pending"}
              strong={row.strong}
            />
          ))}
          <Line label="Invoice" value={breakdown.invoiceNumber} />

          <Text className="font-brand text-[12px] leading-4 text-ink/60">
            By paying you approve this amount. The label is created only after the payment is confirmed.
          </Text>

          {allowSavedCard ? (
            <Button loading={payWithSavedCard.isPending} disabled={busy || status.waiting} onPress={() => guarded(payWithSavedCard)}>
              {"Pay " + (totalLabel || "") + " with saved card" + (card?.last4 ? " •••• " + card.last4 : "")}
            </Button>
          ) : null}
          <Button
            variant={allowSavedCard ? "outline" : "default"}
            loading={openSecurePage.isPending}
            disabled={busy || status.waiting}
            onPress={() => guarded(openSecurePage)}
          >
            Pay on the secure page
          </Button>

          {noSavedCard && zohoActions.addPaymentMethod ? (
            <Button variant="outline" disabled={busy} onPress={() => guarded(openZohoPage, ZOHO_ADD_PAYMENT_METHOD_PATH)}>
              Add a payment method
            </Button>
          ) : null}
          {declined && zohoActions.updateCard ? (
            <Button variant="outline" disabled={busy} onPress={() => guarded(openZohoPage, ZOHO_UPDATE_CARD_PATH)}>
              Update your card
            </Button>
          ) : null}
        </View>
      )}

      {status.waiting || reading?.state === "pending" ? (
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
