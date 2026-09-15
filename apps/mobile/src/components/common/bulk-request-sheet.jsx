import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronRight, ScanLine, Trash2, Truck } from "lucide-react-native";

import { api } from "@/lib/api";
import { formatErrorMessage } from "@/lib/utils";
import { bulkActionSummary, bulkRequestBody } from "@/lib/mail-selection";
import { formatServiceNoticeMessage, normalizeBasicPlanServiceNotices } from "@/lib/service-notices";
import { Button } from "@/components/ui/button";
import { Modal, Notice } from "@/components/ui/modal";

/**
 * Pedir una solicitud para varias piezas a la vez.
 *
 * Una sola solicitud con todas las piezas, no una por pieza: el staff ve un
 * reenvio, un escaneo o un descarte con todo lo elegido. El reenvio de cartas
 * lo abre quien usa esta hoja (LetterForwardSheet, que ya recibe varias). Escanear
 * y descartar se confirman aqui.
 *
 * Solo va a cada solicitud lo que la admite: si de cinco elegidas dos ya tienen
 * un escaneo en marcha, se escanean tres y se dice.
 */

const OPTIONS = {
  FORWARD: {
    icon: Truck,
    label: "Forward letters",
    detail: (count) => (count === 1 ? "1 letter, shipped by your center." : count + " letters in one envelope."),
  },
  SCAN: {
    icon: ScanLine,
    label: "Scan",
    detail: (count) => (count === 1 ? "1 item scanned by your center." : count + " items in one scan request."),
  },
  DISCARD: {
    icon: Trash2,
    label: "Discard",
    detail: (count) => (count === 1 ? "1 item securely destroyed." : count + " items securely destroyed."),
  },
};

function plural(count, word) {
  return count + " " + word + (count === 1 ? "" : "s");
}

function OptionRow({ summary, onPress }) {
  const option = OPTIONS[summary.action];
  const Icon = option.icon;
  const count = summary.eligible.length;
  const disabled = count === 0;
  const destructive = summary.action === "DISCARD";

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className="flex-row items-center gap-3 rounded-lg border border-border bg-card p-4 active:bg-muted"
      style={disabled ? { opacity: 0.5 } : null}
    >
      <View
        className={
          destructive
            ? "h-10 w-10 items-center justify-center rounded-full bg-rose-50"
            : "h-10 w-10 items-center justify-center rounded-full bg-primary/10"
        }
      >
        <Icon size={20} color={destructive ? "#be123c" : "#0f172a"} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className={destructive ? "text-base font-semibold text-rose-700" : "text-base font-semibold text-foreground"}>
          {option.label}
        </Text>
        <Text className="mt-0.5 text-sm leading-5 text-muted-foreground">
          {disabled ? "Not available for the selected items." : option.detail(count)}
        </Text>
        {!disabled && summary.skipped ? (
          <Text className="mt-0.5 text-xs leading-4 text-amber-800">
            {plural(summary.skipped, "selected item") + " can't be included."}
          </Text>
        ) : null}
      </View>
      {!disabled ? <ChevronRight size={18} color="#94a3b8" /> : null}
    </Pressable>
  );
}

export default function BulkRequestSheet({ visible, onClose, selectedItems, onForward, onCompleted }) {
  // "menu" elige la solicitud; "SCAN" y "DISCARD" la confirman.
  const [step, setStep] = useState("menu");
  // Las piezas con las que se abrio. Quien la usa la monta con una key nueva en
  // cada apertura; al terminar vacia su seleccion, y sin esto la hoja diria
  // "0 items" mientras se cierra.
  const [items] = useState(() => selectedItems || []);
  const summaries = bulkActionSummary(items);
  const summaryFor = (action) => summaries.find((summary) => summary.action === action);

  const noticesQuery = useQuery({
    queryKey: ["client-service-notices"],
    queryFn: async () => (await api.get("/client/service-notices")).data,
    enabled: visible,
  });
  // El aviso de precio del escaneo es del plan Basic; a un Premium no le toca.
  const isPremium = noticesQuery.data?.servicePlan === "PREMIUM";
  const scanNotice = normalizeBasicPlanServiceNotices(noticesQuery.data?.basicPlanServiceNotices).scan;

  const request = useMutation({
    mutationFn: async (action) =>
      (await api.post("/client/service-requests", bulkRequestBody(action, summaryFor(action).eligible))).data,
    onSuccess: async (_data, action) => {
      const count = summaryFor(action).eligible.length;
      Alert.alert(
        "Request sent",
        action === "DISCARD"
          ? "Your center will discard " + plural(count, "item") + "."
          : "Your center will scan " + plural(count, "item") + "."
      );
      onClose();
      await onCompleted?.();
    },
    onError: (error) => {
      Alert.alert("Could not send request", formatErrorMessage(error, "The request could not be sent."));
    },
  });

  const choose = (action) => {
    if (action === "FORWARD") {
      onForward(summaryFor("FORWARD").eligible);
      return;
    }
    setStep(action);
  };

  if (step === "SCAN" || step === "DISCARD") {
    const count = summaryFor(step).eligible.length;
    const discard = step === "DISCARD";

    return (
      <Modal
        visible={visible}
        onClose={onClose}
        title={discard ? "Discard " + plural(count, "item") + "?" : "Scan " + plural(count, "item") + "?"}
        description={
          discard
            ? "Your center securely destroys them. This cannot be undone."
            : "Your center opens and scans them, and the scans appear on each item."
        }
        footer={
          <>
            <Button
              variant={discard ? "destructive" : "default"}
              loading={request.isPending}
              onPress={() => request.mutate(step)}
            >
              {discard ? "Discard " + plural(count, "item") : !isPremium ? scanNotice.confirmLabel : "Request scan"}
            </Button>
            <Button variant="outline" disabled={request.isPending} onPress={() => setStep("menu")}>
              Back
            </Button>
          </>
        }
      >
        {step === "SCAN" && !isPremium ? (
          <Notice tone="amber">
            {scanNotice.title}: {formatServiceNoticeMessage(scanNotice)}
          </Notice>
        ) : null}
        {discard ? (
          <Notice tone="rose">{"Only discard mail you don't need. The center will not keep a copy."}</Notice>
        ) : null}
      </Modal>
    );
  }

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title={"Request for " + plural(items.length, "item")}
      description="Your center receives one request with all the items it applies to."
    >
      {summaries.map((summary) => (
        <OptionRow key={summary.action} summary={summary} onPress={() => choose(summary.action)} />
      ))}
    </Modal>
  );
}
