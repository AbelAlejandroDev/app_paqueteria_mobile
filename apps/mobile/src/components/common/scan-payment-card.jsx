import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { notifyCapabilitiesStale } from "@/lib/capabilities-events";
import { createSingleFlight } from "@/lib/forward-payment";
import { formatMoneyFromCents } from "@/lib/mail-item-detail";
import { interpretScanPayment, isScanPaymentUnsupported, SCAN_PAYMENT_QUERY_KEY, scanPaymentPath } from "@/lib/scan-payment";
import { BILLING_PAYMENT_QUERY_KEY, useCapabilities } from "@/lib/use-capabilities";
import { zohoBillingErrorMessage, zohoInvoicePayPath, zohoPageUrl } from "@/lib/zoho-billing";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/modal";

/**
 * Cobro pendiente de un escaneo (lib/scan-payment). Solo lee GET scan-payment;
 * pagar es siempre una pulsacion del cliente, en la factura de SU proveedor:
 * Zoho (pagina segura de esa factura) o Stripe (su factura). Nunca Stripe en HDG.
 * Con el backend anterior (sin la ruta) no enseña nada.
 */
export default function ScanPaymentCard({ request, onRefresh }) {
  const queryClient = useQueryClient();
  const capabilities = useCapabilities();
  const [lock] = useState(createSingleFlight);
  const key = [SCAN_PAYMENT_QUERY_KEY, request.id];

  const query = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get(scanPaymentPath(request.id))).data,
    retry: false,
    staleTime: 15 * 1000,
  });

  const refresh = async () => {
    notifyCapabilitiesStale("scan-payment");
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: [BILLING_PAYMENT_QUERY_KEY] });
    queryClient.invalidateQueries({ queryKey: ["client-payment-alerts"] });
    await onRefresh?.();
  };

  const payZohoInvoice = useMutation({
    mutationFn: async (invoiceId) => {
      const url = zohoPageUrl((await api.post(zohoInvoicePayPath(invoiceId))).data);
      if (!url) throw new Error("INVALID_PAYMENT_URL");
      // La vuelta va al portal web y no confirma nada: al volver se relee.
      await WebBrowser.openBrowserAsync(url);
    },
    onSettled: refresh,
    onError: (error) =>
      Alert.alert(
        "Could not open the invoice",
        error?.message === "INVALID_PAYMENT_URL" ? "We could not open the secure payment page. Please try again." : zohoBillingErrorMessage(error)
      ),
  });

  if (query.isLoading || isScanPaymentUnsupported(query.error)) return null;
  if (query.isError) return null;

  const view = interpretScanPayment(query.data, { accountProvider: capabilities.provider });
  if (!view.visible) return null;

  const amount = query.data?.amount;

  return (
    <View className="gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <Text className="font-brand-bold text-[15px] text-ink">Scan payment</Text>
      <Notice tone="amber">{view.message}</Notice>
      {amount ? <Text className="font-brand text-[13px] text-ink/70">{"Scan charge: " + formatMoneyFromCents(amount)}</Text> : null}

      {view.action === "zoho-invoice" ? (
        <Button loading={payZohoInvoice.isPending} disabled={payZohoInvoice.isPending} onPress={() => lock.run(() => payZohoInvoice.mutateAsync(view.invoiceId).catch(() => {}))}>
          {"Pay invoice" + (view.invoiceNumber ? " " + view.invoiceNumber : "")}
        </Button>
      ) : null}
      {view.action === "stripe-invoice" ? (
        <Button onPress={() => WebBrowser.openBrowserAsync(view.url).then(refresh)}>Pay invoice</Button>
      ) : null}
      {view.action === "billing" ? (
        <Button variant="outline" onPress={() => router.navigate("/billing")}>
          Go to Billing
        </Button>
      ) : null}
      {view.action === "check" ? (
        <Button variant="outline" loading={query.isFetching} onPress={() => query.refetch()}>
          Check again
        </Button>
      ) : null}
      {view.action === "contact" ? (
        <Text className="font-brand text-[12px] leading-4 text-ink/60">Contact your center if you have questions about this charge.</Text>
      ) : null}
    </View>
  );
}
