import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ChevronRight, ScanLine, Trash2, Truck } from "lucide-react-native";

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
  NOT_MINE: {
    icon: AlertCircle,
    label: "Not mine",
    detail: (count) =>
      count === 1 ? "Your center reviews 1 item's assignment." : "Your center reviews the assignment of " + count + " items.",
  },
};

const TONES = {
  DISCARD: { circle: "bg-rose-50", icon: "#be123c", label: "text-rose-700" },
  NOT_MINE: { circle: "bg-amber-50", icon: "#92400e", label: "text-amber-900" },
};
const DEFAULT_TONE = { circle: "bg-primary/10", icon: "#0f172a", label: "text-foreground" };

function plural(count, word) {
  return count + " " + word + (count === 1 ? "" : "s");
}

function OptionRow({ summary, onPress }) {
  const option = OPTIONS[summary.action];
  const Icon = option.icon;
  const count = summary.eligible.length;
  const disabled = count === 0;
  const tone = TONES[summary.action] || DEFAULT_TONE;
  // El porque, agrupado: "Packages can't be scanned. 1 item is already scanned."
  const reasons = summary.reasons.map((reason) => reason.text).join(" ");

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className="flex-row items-center gap-3 rounded-lg border border-border bg-card p-4 active:bg-muted"
      style={disabled ? { opacity: 0.5 } : null}
    >
      <View className={"h-10 w-10 items-center justify-center rounded-full " + tone.circle}>
        <Icon size={20} color={tone.icon} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className={"text-base font-semibold " + tone.label}>{option.label}</Text>
        {/* Sin ninguna: en gris y con el motivo. Con algunas fuera: el motivo
            de esas, en ambar. */}
        <Text className="mt-0.5 text-sm leading-5 text-muted-foreground">
          {disabled ? reasons || "Not available for the selected items." : option.detail(count)}
        </Text>
        {!disabled && summary.skipped ? (
          <Text className="mt-0.5 text-xs leading-4 text-amber-800">
            {plural(summary.skipped, "selected item") + " won't be included. " + reasons}
          </Text>
        ) : null}
      </View>
      {!disabled ? <ChevronRight size={18} color="#94a3b8" /> : null}
    </Pressable>
  );
}

export default function BulkRequestSheet({ visible, onClose, selectedItems, onForward, onCompleted }) {
  // "menu" elige la solicitud; "SCAN" y "DISCARD" la confirman.
  const queryClient = useQueryClient();
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
      // Un 409 MULTI_SCAN_ITEM_NOT_ALLOWED / MULTI_DISCARD_ITEM_NOT_ALLOWED dice
      // que piezas cambiaron ("#000007"): la lista se vuelve a pedir para que
      // la seleccion refleje su estado real.
      queryClient.invalidateQueries({ queryKey: ["client-mail-items"] });
      Alert.alert("Could not send request", formatErrorMessage(error, "The request could not be sent."));
    },
  });

  /**
   * "Not mine" abre una revision de asignacion por pieza: el backend no tiene una
   * para varias, y el centro revisa cada foto por separado. Se mandan de una en
   * una para poder decir cuales fallaron.
   */
  const rejectAssignments = useMutation({
    mutationFn: async () => {
      const eligible = summaryFor("NOT_MINE").eligible;
      const failed = [];
      for (const item of eligible) {
        try {
          await api.post("/client/mail-items/" + encodeURIComponent(item.id) + "/reject-assignment", {});
        } catch (error) {
          failed.push({ item, message: formatErrorMessage(error, "Could not send") });
        }
      }
      return { sent: eligible.length - failed.length, failed };
    },
    onSuccess: async ({ sent, failed }) => {
      if (failed.length) {
        Alert.alert(
          sent ? "Some items were not sent" : "Could not send",
          failed.map(({ item, message }) => (item.itemCode || item.id) + ": " + message).join("\n")
        );
      } else {
        Alert.alert("Sent", "Your center will review " + plural(sent, "item") + ".");
      }
      onClose();
      await onCompleted?.();
    },
  });

  const choose = (action) => {
    if (action === "FORWARD") {
      onForward(summaryFor("FORWARD").eligible);
      return;
    }
    setStep(action);
  };

  if (step === "NOT_MINE") {
    const count = summaryFor("NOT_MINE").eligible.length;

    return (
      <Modal
        visible={visible}
        onClose={onClose}
        title={count === 1 ? "This item is not yours?" : "These " + count + " items are not yours?"}
        description="Staff will review the photo and assignment of each item, and reassign or discard it."
        footer={
          <>
            <Button
              className="border-amber-300 bg-amber-50"
              labelClassName="text-amber-900"
              variant="outline"
              loading={rejectAssignments.isPending}
              onPress={() => rejectAssignments.mutate()}
            >
              Send to staff
            </Button>
            <Button variant="outline" disabled={rejectAssignments.isPending} onPress={() => setStep("menu")}>
              Back
            </Button>
          </>
        }
      >
        <Notice tone="amber">
          Use this only when the mail belongs to another renter or was assigned to your mailbox by mistake.
        </Notice>
      </Modal>
    );
  }

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
