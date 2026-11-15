import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { notifyCapabilitiesStale } from "@/lib/capabilities-events";
import { createSingleFlight } from "@/lib/forward-payment";
import { formatMoneyFromCents } from "@/lib/mail-item-detail";
import { approveScanError, approveScanPath, interpretApproveScan, scanApprovalAvailability } from "@/lib/scan-approval";
import { BILLING_PAYMENT_QUERY_KEY, useCapabilities } from "@/lib/use-capabilities";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/modal";

function Line({ label, value }) {
  if (value === null || value === undefined) return null;
  return (
    <View className="flex-row items-center justify-between gap-3 py-0.5">
      <Text className="font-brand text-[14px] text-ink/70">{label}</Text>
      <Text className="font-brand-semibold text-[14px] text-ink">{value}</Text>
    </View>
  );
}

/**
 * Escaneo cotizado por el centro que espera la aprobacion del cliente
 * (lib/scan-approval). Aprobar es consentir el cobro: con cargo se pregunta
 * antes, con el importe. Nunca se aprueba ni se cobra solo, ni se repite.
 */
export default function ScanApprovalCard({ request, onRefresh }) {
  const queryClient = useQueryClient();
  const capabilities = useCapabilities();
  const availability = scanApprovalAvailability(request, capabilities);
  const { quote } = availability;
  const [lock] = useState(createSingleFlight);
  const [outcome, setOutcome] = useState(null);

  const refreshAll = async () => {
    notifyCapabilitiesStale("scan-approval");
    queryClient.invalidateQueries({ queryKey: ["client-mail-items"] });
    queryClient.invalidateQueries({ queryKey: [BILLING_PAYMENT_QUERY_KEY] });
    queryClient.invalidateQueries({ queryKey: ["client-billing-usage"] });
    queryClient.invalidateQueries({ queryKey: ["client-payment-alerts"] });
    queryClient.invalidateQueries({ queryKey: ["client-notifications"] });
    await onRefresh?.();
  };

  const approve = useMutation({
    mutationFn: async () => (await api.post(approveScanPath(request.id))).data,
    onSuccess: (data) => {
      const result = interpretApproveScan(data);
      setOutcome({
        kind: "approved",
        message: result.paidAmountCents > 0
          ? "Scan approved and paid (" + formatMoneyFromCents(result.paidAmountCents) + ")."
          : "Scan approved.",
      });
      refreshAll();
    },
    onError: (error) => {
      setOutcome(approveScanError(error, capabilities.provider));
      refreshAll();
    },
  });

  const run = () => lock.run(() => approve.mutateAsync().catch(() => {}));

  const onApprove = () => {
    if (!availability.charge) return run();
    // Aprobar es consentir el cobro: se pide de forma explicita, con el importe.
    Alert.alert(
      "Approve and pay",
      "You will be charged " + formatMoneyFromCents(quote.amountCents) + " for this scan.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Approve and pay", onPress: run },
      ]
    );
    return null;
  };

  if (outcome?.kind === "approved") {
    return (
      <Notice tone="emerald" className="mt-2">
        {outcome.message}
      </Notice>
    );
  }

  return (
    <View className="gap-2">
      <Line label="Pages" value={quote.pageCount} />
      <Line label="Included" value={quote.includedPages} />
      <Line label="Extra" value={quote.extraPages} />
      <Line label="Total" value={quote.amountCents != null ? formatMoneyFromCents(quote.amountCents) : null} />
      {quote.notes ? <Text className="font-brand text-[13px] leading-5 text-ink/60">{quote.notes}</Text> : null}

      {outcome ? <Notice tone="amber">{outcome.message}</Notice> : null}
      {outcome?.action === "invoice" ? (
        <Button variant="outline" onPress={() => WebBrowser.openBrowserAsync(outcome.url).then(refreshAll)}>
          {outcome.actionLabel}
        </Button>
      ) : null}
      {outcome?.action === "billing" || outcome?.kind === "billing-required" ? (
        <Button variant="outline" onPress={() => router.navigate("/billing")}>
          Go to Billing
        </Button>
      ) : null}

      {outcome ? null : availability.state === "available" ? (
        <>
          <Button loading={approve.isPending} disabled={approve.isPending} onPress={onApprove}>
            {availability.charge ? "Approve and pay " + formatMoneyFromCents(quote.amountCents) : "Approve scan"}
          </Button>
          {availability.charge ? (
            <Text className="font-brand text-[12px] leading-4 text-ink/60">
              Approving charges this amount to the payment method your center has on file.
            </Text>
          ) : null}
        </>
      ) : availability.state === "billing-hold" ? (
        <>
          <Notice tone="amber">{availability.reason || "Billing needs attention before approving services."}</Notice>
          <Button variant="outline" onPress={() => router.navigate("/billing")}>
            Go to Billing
          </Button>
        </>
      ) : availability.state === "unavailable" ? (
        <Notice tone="amber">Paid scans can&apos;t be approved online for your account. Please contact your center.</Notice>
      ) : availability.state === "incomplete" ? (
        <Notice tone="amber">Your center is still preparing this quote.</Notice>
      ) : capabilities.isLoading ? (
        <Button loading disabled>
          Approve scan
        </Button>
      ) : (
        <View className="gap-2">
          <Notice tone="amber">We could not load the options for your account.</Notice>
          <Button variant="outline" onPress={() => capabilities.refetch()}>
            Try again
          </Button>
        </View>
      )}
    </View>
  );
}
