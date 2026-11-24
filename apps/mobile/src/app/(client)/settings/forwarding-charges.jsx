import { useState } from "react";
import { Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { Redirect } from "expo-router";

import { consentErrorOutcome, describeConsent, isOfferAccepted } from "@/lib/auto-charge-consent";
import { useAutoChargeConsent } from "@/lib/use-auto-charge-consent";
import { formatDate, formatErrorMessage } from "@/lib/utils";
import AutoChargeConsentOffer from "@/components/common/auto-charge-consent-offer";
import { CardHeading, DetailCard, DetailRow } from "@/components/common/mail-item-detail-ui";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";

const STATUS_LABEL = {
  authorized: "Authorized",
  "not-authorized": "Not authorized",
  outdated: "Needs your new acceptance",
  "center-changed": "Needs your new acceptance",
  unavailable: "Not available",
  unknown: "Unknown",
};

const OFFER_NOTICE = {
  outdated: "The authorization text was updated. Read the new text and accept it again to keep automatic charges.",
  "center-changed": "Your previous authorization was for another center. Accept it again for your current center.",
};

/**
 * Ajustes de reenvio: autorizacion de cobro automatico (HDG). Todo lo que se
 * ensena sale de GET/PUT /client/forwarding/auto-charge-consent
 * (lib/auto-charge-consent): estado, maximo efectivo con su moneda, texto
 * completo y la opcion de retirarla. Nada se da por autorizado sin `valid`.
 */
export default function ForwardingChargesScreen() {
  const { enabled, query, consent, grant, revoke } = useAutoChargeConsent();
  const [acceptedKey, setAcceptedKey] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [problem, setProblem] = useState(null);

  if (!enabled) return <Redirect href="/settings" />;

  const offer = consent.offer;
  const checked = isOfferAccepted(acceptedKey, offer);
  const busy = grant.isPending || revoke.isPending;

  const submitGrant = async () => {
    if (!checked || !offer || busy) return;
    setProblem(null);
    setConfirmation(null);
    try {
      const result = describeConsent(await grant.mutateAsync(offer));
      setAcceptedKey(null);
      if (result.valid) {
        setConfirmation("Automatic charges authorized up to " + result.effectiveMaxLabel + " per shipment.");
      } else {
        // La API no la confirmo: no se ensena como autorizada.
        setProblem("Your center didn't confirm the authorization. Review the current text and try again.");
      }
    } catch (error) {
      setAcceptedKey(null);
      setProblem(consentErrorOutcome(error).message);
    }
  };

  const confirmRevoke = () => {
    Alert.alert(
      "Withdraw authorization?",
      "Your center will no longer charge your saved card automatically. Future shipments will wait for you to approve and pay them in the app.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Withdraw",
          style: "destructive",
          onPress: async () => {
            setProblem(null);
            setConfirmation(null);
            try {
              const result = describeConsent(await revoke.mutateAsync());
              if (result.valid) {
                setProblem("Your center didn't confirm the change. Pull down to check the current status.");
                return;
              }
              const message =
                "Authorization withdrawn. Your center can no longer charge your card automatically. A charge that was already in progress is still being confirmed.";
              setConfirmation(message);
              Alert.alert("Authorization withdrawn", message);
            } catch (error) {
              setProblem(formatErrorMessage(error, "The authorization couldn't be withdrawn. Please try again."));
            }
          },
        },
      ]
    );
  };

  const authorization = consent.authorization;

  return (
    <ScrollView
      className="flex-1 bg-canvas"
      contentContainerClassName="gap-4 p-4 pb-24"
      refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} />}
    >
      <DetailCard className="gap-2 p-5">
        <CardHeading className="mb-1">Automatic Forwarding Charges</CardHeading>
        <Text className="font-brand text-[14px] leading-6 text-ink/80">
          When you request forwarding for a letter or large envelope, your center weighs it, gets the shipping rate and
          shows you the total. With this authorization, your center can charge your saved card for that total without
          waiting for you, as long as it is within your maximum per shipment. Packages are not included.
        </Text>
      </DetailCard>

      {confirmation ? <Notice tone="emerald">{confirmation}</Notice> : null}
      {problem ? <Notice tone="rose">{problem}</Notice> : null}

      {query.isLoading ? <Skeleton className="h-40 w-full" /> : null}

      {query.isError ? (
        <View className="gap-2">
          <Notice tone="rose">{formatErrorMessage(query.error, "Unable to load your authorization.")}</Notice>
          <Button variant="outline" onPress={() => query.refetch()}>
            Try again
          </Button>
        </View>
      ) : null}

      {query.isSuccess ? (
        <DetailCard className="px-5 pb-2 pt-5">
          <DetailRow label="Status" value={STATUS_LABEL[consent.state] || STATUS_LABEL.unknown} />
          {consent.valid ? <DetailRow label="Maximum per shipment" value={consent.effectiveMaxLabel} /> : null}
          {consent.valid && authorization?.grantedAt ? <DetailRow label="Authorized on" value={formatDate(authorization.grantedAt)} /> : null}
          <DetailRow label="Currency" value={consent.currency || "-"} last />
        </DetailCard>
      ) : null}

      {query.isSuccess && consent.state === "unavailable" && !consent.canRevoke ? (
        <Notice tone="sky">
          {"Automatic charges aren't offered for your account right now. Your center will ask you to pay each shipment in the app."}
        </Notice>
      ) : null}

      {/* Alta: solo con la oferta completa de la API. */}
      {query.isSuccess && offer ? (
        <View className="gap-3">
          <AutoChargeConsentOffer
            offer={offer}
            checked={checked}
            disabled={busy}
            notice={OFFER_NOTICE[consent.state] || null}
            onToggle={() => setAcceptedKey(checked ? null : offer.key)}
          />
          <Button loading={grant.isPending} disabled={!checked || busy} onPress={submitGrant}>
            Authorize automatic charges
          </Button>
        </View>
      ) : null}

      {/* Lo que el cliente acepto en su dia (si se pudo verificar). */}
      {query.isSuccess && authorization?.text ? (
        <DetailCard className="gap-2 p-5">
          <Text className="font-brand-semibold text-[14px] text-ink">
            {consent.valid ? "Authorization you accepted" : "Previous authorization"}
          </Text>
          <Text selectable className="font-brand text-[13px] leading-5 text-ink/80">
            {authorization.text}
          </Text>
        </DetailCard>
      ) : null}

      {query.isSuccess && consent.canRevoke ? (
        <Button variant="destructive" loading={revoke.isPending} disabled={busy} onPress={confirmRevoke}>
          Withdraw authorization
        </Button>
      ) : null}
    </ScrollView>
  );
}
