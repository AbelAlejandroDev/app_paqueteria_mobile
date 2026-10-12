import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Switch, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
// Con nombre propio porque `Linking` de react-native ya esta importado arriba
// y aqui se usan los dos: aquel abre URLs, este construye el deep link.
import * as ExpoLinking from "expo-linking";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, ImageIcon, ScanLine, Store, Trash2, Truck } from "lucide-react-native";

import { api } from "@/lib/api";
import { brand } from "@/lib/brand";
import { useAuth } from "@/context/AuthContext";
import { formatDate, formatErrorMessage } from "@/lib/utils";
import { formatStatusDisplay, getCurrentStatusLabel, getItemStatusDisplay, getMailTypeLabel } from "@/lib/mail-item-display";
import {
  buildTimeline,
  findRequest,
  formatEventTime,
  formatItemWeight,
  formatMoneyFromCents,
  getScanMedia,
  getVisibleMedia,
  hasDisplayValue,
  PAYABLE_PAYMENT_STATUSES,
  requestStatusColor,
} from "@/lib/mail-item-detail";
import { formatServiceNoticeMessage, normalizeBasicPlanServiceNotices } from "@/lib/service-notices";
import { US_STATES } from "@/lib/us-states";
import EmptyState from "@/components/common/empty-state";
import LetterForwardSheet from "@/components/common/letter-forward-sheet";
import { isPdfMedia, PdfThumbnail, PdfViewer } from "@/components/common/pdf-viewer";
import {
  ActionButton,
  ActionGrid,
  CardHeading,
  CardSubheading,
  DetailCard,
  DetailRow,
  ImageViewer,
  ItemHeaderTitle,
  MailboxChip,
  ProgressNotice,
  SectionLabel,
  StatusPill,
  Timeline,
  TimelineDetailLine,
  TimelineDetails,
  TypeChip,
  ViewPill,
} from "@/components/common/mail-item-detail-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Modal, Notice } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const EMPTY_FORWARD = {
  recipient: "",
  address1: "",
  address2: "",
  city: "",
  state: "",
  zip: "",
  phone: "",
  trackingRequested: false,
  insuranceRequested: false,
  insuredValue: "",
};

/** Tope del backend: insuredValueCents como máximo 500000. */
const MAX_INSURED_VALUE_USD = 5000;

function toInsuredValueCents(form) {
  const value = Number(form.insuredValue || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 100);
}

function SummaryLine({ label, value }) {
  if (!hasDisplayValue(value)) return null;

  return (
    <Text className="font-hanken text-[14px] text-ink">
      <Text className="font-hanken-semibold">{label}: </Text>
      {value}
    </Text>
  );
}

/** Tarjeta de aviso con titulo (pago, cotizacion, rechazo...). */
function NoticeCard({ tone, title, description, children }) {
  return (
    <DetailCard tone={tone} className="gap-1.5 p-5">
      <CardHeading className="text-[16px]">{title}</CardHeading>
      {description ? <CardSubheading className="mb-1">{description}</CardSubheading> : null}
      {children}
    </DetailCard>
  );
}

function ToggleRow({ label, description, value, onValueChange }) {
  return (
    <View className="flex-row items-start justify-between gap-3 rounded-lg border border-border bg-card p-3">
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-medium text-foreground">{label}</Text>
        <Text className="mt-1 text-xs leading-4 text-muted-foreground">{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: brand.primaryColor, false: "#cbd5e1" }}
        thumbColor="#ffffff"
      />
    </View>
  );
}

/**
 * Cobro del reenvio de un paquete.
 *
 * El pago lo aloja Stripe y se abre en el navegador: asi el reto 3DS del banco
 * se resuelve donde Stripe sabe hacerlo, sin meter su SDK nativo en la app.
 * Al volver solo se recarga; quien da el pago por bueno es el webhook, no esta
 * pantalla, que no puede saber si el cargo cuajo.
 */
function ForwardPaymentCard({ request, mailItemId, onRefresh }) {
  const details = request.forwardDetails || {};
  const needsAuthentication = details.paymentStatus === "AUTHENTICATION_REQUIRED";

  const pay = useMutation({
    mutationFn: async () => {
      // La misma URL para las dos salidas: la app no distingue entre pagar y
      // desistir, y en ambos casos hay que volver al item y recargar.
      const returnUrl = ExpoLinking.createURL("/mail-items/" + mailItemId);
      const response = await api.post("/client/forwarding/" + request.id + "/checkout-session", {
        successUrl: returnUrl,
        cancelUrl: returnUrl,
      });

      const url = response.data?.url;
      if (!url) throw new Error("Stripe did not return a payment URL.");

      return WebBrowser.openAuthSessionAsync(url, returnUrl);
    },
    onSuccess: async () => {
      await onRefresh?.();
    },
    onError: (error) => {
      Alert.alert("Could not open payment", formatErrorMessage(error, "Unable to start the payment."));
    },
  });

  return (
    <NoticeCard
      tone="amber"
      title="Forward Payment"
      description={
        needsAuthentication ? "Your bank asked to verify this payment." : "Forwarding rate selected, payment pending."
      }
    >
      <SummaryLine label="Carrier" value={details.quotedCarrier} />
      <SummaryLine label="Service" value={details.quotedService} />
      <SummaryLine label="Accepted quote" value={formatMoneyFromCents(details.quotedAmountCents)} />
      <SummaryLine label="Payment" value={formatStatusDisplay(details.paymentStatus)} />

      {needsAuthentication ? (
        <Notice tone="amber" className="mt-2">
          Your card is fine, but the bank needs you to confirm this charge. Tap below to finish it.
        </Notice>
      ) : null}

      <Button className="mt-3" loading={pay.isPending} onPress={() => pay.mutate()}>
        {needsAuthentication ? "Verify and pay" : "Pay now"}
      </Button>

      <Text className="mt-1 font-hanken text-[12px] leading-4 text-ink/60">
        Payment opens in a secure Stripe page. It can take a moment to show as paid here.
      </Text>
    </NoticeCard>
  );
}

/** "13" y "13.5 oz", sin decimales de adorno. */
function formatOunces(value) {
  const ounces = Number(value);
  if (!Number.isFinite(ounces) || ounces <= 0) return null;
  return (Number.isInteger(ounces) ? ounces : ounces.toFixed(1)) + " oz";
}

/**
 * El sobre pesa mas de lo que USPS admite sin seguimiento.
 *
 * First-Class es el unico servicio sin seguimiento y corta en 13 oz, asi que un
 * reenvio pedido sin el se queda parado hasta que el cliente acepte pagarlo o
 * renuncie al envio. Es la unica espera que queda en AWAITING_CLIENT_APPROVAL:
 * la aprobacion antigua la retiro el backend porque daba el envio por pagado
 * sin cobrarlo.
 */
function TrackingApprovalCard({ request, onRefresh }) {
  const details = request.forwardDetails || {};
  const weight = formatOunces(details.trackingApprovalWeightOunces);
  const limit = formatOunces(details.trackingApprovalLimitOunces);

  const respond = useMutation({
    mutationFn: async (decision) =>
      (await api.post("/client/service-requests/" + request.id + "/tracking-approval", { decision })).data,
    onSuccess: async () => {
      await onRefresh?.();
    },
    onError: (error) => {
      // Aceptar acaba en un cobro, asi que el backend lo rechaza con la cuenta
      // en mora. Rechazar no mueve dinero y siempre se puede.
      Alert.alert("Could not send your answer", formatErrorMessage(error, "Please try again in a moment."));
    },
  });

  const confirmDecline = () => {
    Alert.alert(
      "Decline tracking?",
      "Your forwarding request will be cancelled and the mail stays at the center.",
      [
        { text: "Keep waiting", style: "cancel" },
        { text: "Decline", style: "destructive", onPress: () => respond.mutate("DECLINE") },
      ]
    );
  };

  return (
    <NoticeCard
      tone="amber"
      title="Tracking needed to forward this"
      description={
        weight && limit
          ? `Your mail weighs ${weight}, over the ${limit} that USPS allows without tracking.`
          : "This shipment is over the weight USPS allows without tracking."
      }
    >
      <SummaryLine label="Service" value={details.trackingApprovalEstimateService} />
      <SummaryLine
        label="Estimated cost"
        value={
          details.trackingApprovalEstimateCents != null
            ? formatMoneyFromCents(details.trackingApprovalEstimateCents)
            : null
        }
      />

      <Text className="mt-2 font-hanken text-[14px] leading-6 text-ink">
        {details.trackingApprovalEstimateCents != null
          ? "This is an estimate. You will see the final price before paying."
          : "The center will price it and show you the final amount before you pay."}
      </Text>

      <Button className="mt-3" loading={respond.isPending} onPress={() => respond.mutate("APPROVE")}>
        Approve tracking
      </Button>
      <Button variant="outline" disabled={respond.isPending} onPress={confirmDecline}>
        Decline
      </Button>
    </NoticeCard>
  );
}

function ActionsCard({ item, mailItemId, availableActions, serviceNotices, supportEmail, onRefresh }) {
  const [forwardOpen, setForwardOpen] = useState(false);
  // Cada apertura monta la hoja de nuevo (key distinta): empieza siempre por el
  // aviso del recargo y sin lo que se escribio la vez anterior.
  const [letterForwardKey, setLetterForwardKey] = useState(0);
  const [letterForwardOpen, setLetterForwardOpen] = useState(false);
  const [pickupOpen, setPickupOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [noticeService, setNoticeService] = useState(null);

  const [forwardForm, setForwardForm] = useState(EMPTY_FORWARD);
  const [pickupWindow, setPickupWindow] = useState("");
  const [forwardQuoteId, setForwardQuoteId] = useState("");
  const [forwardRates, setForwardRates] = useState([]);
  const [selectedRateId, setSelectedRateId] = useState("");
  // Recargo por no esperar al envio del mes. Va aparte de las tarifas --que ya
  // traen dentro la gestion-- y se cobra igual, asi que sin sumarlo aqui el
  // cliente elegiria viendo menos de lo que se le va a cobrar.
  const [immediateFeeCents, setImmediateFeeCents] = useState(0);

  const { user } = useAuth();
  const isLetter = item?.type === "LETTER";

  const clearRates = () => {
    // Se llama en cada pulsación, así que conviene no re-renderizar de balde.
    if (!forwardQuoteId && forwardRates.length === 0 && !selectedRateId) return;

    setForwardQuoteId("");
    setForwardRates([]);
    setSelectedRateId("");
    setImmediateFeeCents(0);
  };

  /**
   * El precio del tracking y del seguro va incluido en cada tarifa, así que
   * cambiar cualquiera de los dos invalida las que ya estén cargadas: dejarlas
   * en pantalla mostraría un importe que el backend ya no cobraría.
   */
  const onQuoteField = (field) => (value) => {
    clearRates();
    setForwardForm((current) => ({ ...current, [field]: value }));
  };

  const defaultAddress = user?.clientProfile || null;
  const hasDefaultAddress = Boolean(defaultAddress?.addressLine1 && defaultAddress?.city);

  const useDefaultAddress = () => {
    if (!hasDefaultAddress) return;

    clearRates();
    setForwardForm((current) => ({
      ...current,
      recipient: defaultAddress.fullName || current.recipient,
      address1: defaultAddress.addressLine1 || "",
      address2: defaultAddress.addressLine2 || "",
      city: defaultAddress.city || "",
      state: defaultAddress.state || "",
      zip: defaultAddress.zip || "",
      // El perfil del cliente no guarda teléfono; se conserva el escrito.
    }));
  };

  const createRequest = useMutation({
    mutationFn: async ({ type, payload }) => {
      const response = await api.post("/client/service-requests", { mailItemId, type, ...(payload || {}) });
      return response.data;
    },
    onSuccess: async () => {
      Alert.alert("Request created", "Your request was sent to the center.");
      setForwardOpen(false);
      setPickupOpen(false);
      setDiscardOpen(false);
      await onRefresh?.();
    },
    onError: (error) => {
      Alert.alert("Could not create request", formatErrorMessage(error, "Failed to create request"));
      onRefresh?.();
    },
  });

  const rejectAssignment = useMutation({
    mutationFn: async () => {
      const response = await api.post("/client/mail-items/" + mailItemId + "/reject-assignment", {});
      return response.data;
    },
    onSuccess: async () => {
      Alert.alert("Sent", "The center will review this assignment.");
      setRejectOpen(false);
      await onRefresh?.();
    },
    onError: (error) => {
      Alert.alert("Could not send", formatErrorMessage(error, "Failed to send assignment review"));
      onRefresh?.();
    },
  });

  const quoteRates = useMutation({
    mutationFn: async () => {
      const insuredValueCents = forwardForm.insuranceRequested ? toInsuredValueCents(forwardForm) : 0;

      const response = await api.post("/client/forwarding/quotes", {
        mailItemId,
        shippingOptions: {
          trackingRequested: Boolean(forwardForm.trackingRequested),
          insuranceRequested: Boolean(forwardForm.insuranceRequested),
          insuredValueCents,
        },
        destinationAddress: {
          name: forwardForm.recipient,
          addressLine1: forwardForm.address1,
          addressLine2: forwardForm.address2 || undefined,
          cityTown: forwardForm.city,
          stateProvince: forwardForm.state,
          postalCode: forwardForm.zip,
          countryCode: "US",
          phone: forwardForm.phone || undefined,
        },
      });
      return response.data;
    },
    onSuccess: (data) => {
      setForwardQuoteId(data?.quoteId || "");
      setForwardRates(data?.rates || []);
      setSelectedRateId(data?.rates?.[0]?.optionId || "");
      setImmediateFeeCents(Number(data?.immediateForwardFeeCents || 0));
    },
    onError: (error) => {
      setForwardQuoteId("");
      setForwardRates([]);
      setSelectedRateId("");
      setImmediateFeeCents(0);
      Alert.alert("No rates available", formatErrorMessage(error, "Failed to load shipping rates"));
    },
  });

  const selectRate = useMutation({
    mutationFn: async () => {
      const response = await api.post("/client/forwarding/quotes/select", {
        mailItemId,
        quoteId: forwardQuoteId,
        optionId: selectedRateId,
      });
      return response.data;
    },
    onSuccess: async () => {
      Alert.alert("Rate selected", "Your forwarding request was created.");
      setForwardOpen(false);
      await onRefresh?.();
    },
    onError: (error) => {
      Alert.alert("Could not select rate", formatErrorMessage(error, "Unable to select forwarding rate"));
    },
  });

  const anyPending =
    createRequest.isPending || rejectAssignment.isPending || quoteRates.isPending || selectRate.isPending;

  const active = availableActions?.activeRequests || {};
  const activeNotice = noticeService ? serviceNotices[noticeService] : null;

  const forwardFieldsFilled =
    forwardForm.recipient && forwardForm.address1 && forwardForm.city && forwardForm.state && forwardForm.zip && forwardForm.phone;

  const submitScan = () => {
    if (!availableActions?.canRequestScan) return;
    createRequest.mutate({ type: "SCAN", payload: { chargeConsent: true } });
  };

  const submitPickup = () => {
    if (!availableActions?.canRequestPickup) return;
    createRequest.mutate({ type: "PICKUP", payload: { pickupWindow: pickupWindow || undefined } });
  };

  const submitDiscard = () => {
    if (!availableActions?.canRequestDiscard) return;
    createRequest.mutate({ type: "DISCARD", payload: {} });
  };

  /** Validación común a las dos vías; devuelve false y avisa si algo falta. */
  const forwardFormIsValid = () => {
    if (!forwardFieldsFilled) {
      Alert.alert("Missing details", "Fill in the required forwarding fields.");
      return false;
    }

    if (forwardForm.insuranceRequested) {
      const value = Number(forwardForm.insuredValue || 0);

      if (!Number.isFinite(value) || value <= 0) {
        Alert.alert("Insured value missing", "Enter the amount you want to insure.");
        return false;
      }

      if (value > MAX_INSURED_VALUE_USD) {
        Alert.alert("Value too high", "Insurance covers up to $" + MAX_INSURED_VALUE_USD + ".");
        return false;
      }
    }

    return true;
  };

  const getRates = () => {
    if (!forwardFormIsValid()) return;
    quoteRates.mutate();
  };

  const continueWithRate = () => {
    if (!forwardQuoteId || !selectedRateId) {
      Alert.alert("Choose a rate", "Select a shipping rate first.");
      return;
    }
    selectRate.mutate();
  };

  // Los paquetes se reenvían o se recogen, pero su contenido no se escanea.
  const canScan = item?.type !== "PACKAGE" && availableActions?.canRequestScan;

  const selectedRate = forwardRates.find((rate) => rate.optionId === selectedRateId) || null;

  const openForward = () => {
    if (isLetter) {
      setLetterForwardKey((value) => value + 1);
      setLetterForwardOpen(true);
    } else {
      setForwardOpen(true);
    }
  };

  /**
   * Reenviar es la accion principal cuando se puede; si no, lo es el escaneo.
   * Lo demas va de dos en dos debajo. Que botones salen lo decide el servidor,
   * asi que la rejilla se arma con los que haya.
   */
  const forwardAction = availableActions?.canRequestForward ? (
    <ActionButton variant="primary" icon={Truck} disabled={anyPending} onPress={openForward}>
      {isLetter ? "Forward Letter" : "Forward Item"}
    </ActionButton>
  ) : null;

  const scanAction = canScan ? (
    <ActionButton
      variant={forwardAction ? "secondary" : "primary"}
      icon={ScanLine}
      disabled={anyPending}
      onPress={() => setNoticeService("scan")}
    >
      {forwardAction ? "Scan" : "Request Scan"}
    </ActionButton>
  ) : null;

  const secondaryActions = [
    forwardAction ? scanAction : null,
    availableActions?.canRequestPickup ? (
      <ActionButton icon={Store} disabled={anyPending} onPress={() => setPickupOpen(true)}>
        Pickup
      </ActionButton>
    ) : null,
    // Lo que se pisa con un escaneo en marcha lo quita el backend, pero
    // Discard se aparta aqui: descartar lo que se esta escaneando no tiene
    // sentido aunque el servidor lo permita.
    availableActions?.canRequestDiscard && !active.scan ? (
      <ActionButton icon={Trash2} disabled={anyPending} onPress={() => setDiscardOpen(true)}>
        Discard
      </ActionButton>
    ) : null,
  ].filter(Boolean);

  const primaryAction = forwardAction || scanAction;
  const hasActions = Boolean(primaryAction || secondaryActions.length || availableActions?.canRejectAssignment);

  return (
    <View className="gap-2.5 pt-1">
      {hasActions || active.forward || active.scan || availableActions?.billingRestricted ? (
        <SectionLabel>Actions</SectionLabel>
      ) : null}

      <View className="gap-2.5">
        {availableActions?.billingRestricted ? (
          <Notice tone="amber">
            {availableActions.reason || "Billing needs attention before requesting services."}
          </Notice>
        ) : null}

        {/* Con un reenvio en marcha no queda ninguna accion posible: el centro
            ya esta preparando el envio, asi que no se puede escanear, recoger,
            descartar ni rechazar la asignacion. Va antes que el aviso de scan
            porque es la situacion mas restrictiva. */}
        {active.forward ? (
          <ProgressNotice icon={Truck} title="Forwarding in progress">
            The center is preparing your shipment. No other services can be requested for this item in the
            meantime.
          </ProgressNotice>
        ) : (
          <>
            {/* Como en el portal web: el aviso del escaneo no sustituye a los
                botones. Quien recibe correo ajeno no puede esperar a que termine
                un escaneo para decir "Not mine". */}
            {active.scan ? (
              <ProgressNotice icon={ScanLine} title="Scan request in progress">
                Your item is being processed. The scan will appear here once it is ready.
              </ProgressNotice>
            ) : null}

            <ActionGrid primary={primaryAction} secondary={secondaryActions} />

            {availableActions?.canRejectAssignment ? (
              <ActionButton
                variant="tertiary"
                icon={Flag}
                iconColor={brand.palette.sand}
                disabled={anyPending}
                onPress={() => setRejectOpen(true)}
              >
                Not Mine (Report Incorrect Item)
              </ActionButton>
            ) : null}
          </>
        )}

        {/* Aviso de servicio de pago antes de crear la solicitud de escaneo */}
        <Modal
          visible={Boolean(noticeService)}
          onClose={() => setNoticeService(null)}
          title={activeNotice?.title}
          description={activeNotice ? formatServiceNoticeMessage(activeNotice) : undefined}
          footer={
            <>
              <Button
                loading={createRequest.isPending}
                onPress={() => {
                  setNoticeService(null);
                  submitScan();
                }}
              >
                {activeNotice?.confirmLabel || "Continue"}
              </Button>
              <Button variant="outline" onPress={() => setNoticeService(null)}>
                Cancel
              </Button>
            </>
          }
        >
          <Notice tone="amber">
            Your request will be reviewed, and any applicable charge will be shown before the service is completed.
          </Notice>
        </Modal>

        <Modal
          visible={forwardOpen}
          onClose={() => setForwardOpen(false)}
          title="Request Forward"
          description="Enter the destination address and choose a rate."
          footer={
            <Button variant="outline" onPress={() => setForwardOpen(false)}>
              Cancel
            </Button>
          }
        >
          {hasDefaultAddress ? (
            <Button variant="outline" size="sm" onPress={useDefaultAddress}>
              Use my default address
            </Button>
          ) : null}

          <Field label="Recipient">
            <Input value={forwardForm.recipient} onChangeText={onQuoteField("recipient")} />
          </Field>
          <Field label="Address line 1">
            <Input value={forwardForm.address1} onChangeText={onQuoteField("address1")} />
          </Field>
          <Field label="Address line 2 (optional)">
            <Input value={forwardForm.address2} onChangeText={onQuoteField("address2")} />
          </Field>
          <Field label="City">
            <Input value={forwardForm.city} onChangeText={onQuoteField("city")} />
          </Field>
          <Field label="State">
            <Select
              value={forwardForm.state}
              onValueChange={onQuoteField("state")}
              options={US_STATES}
              placeholder="Select state"
              title="State"
            />
          </Field>
          <Field label="ZIP">
            <Input value={forwardForm.zip} onChangeText={onQuoteField("zip")} keyboardType="number-pad" />
          </Field>
          <Field label="Recipient phone">
            <Input value={forwardForm.phone} onChangeText={onQuoteField("phone")} keyboardType="phone-pad" />
          </Field>

          <View className="gap-3">
            <ToggleRow
              label="Add tracking"
              description="First-Class adds Certified Mail; Priority Mail uses Delivery Confirmation."
              value={forwardForm.trackingRequested}
              onValueChange={onQuoteField("trackingRequested")}
            />
            <ToggleRow
              label="Add insurance"
              description="Covers the declared value if the shipment is lost or damaged. Tracking included."
              value={forwardForm.insuranceRequested}
              onValueChange={onQuoteField("insuranceRequested")}
            />
            {forwardForm.insuranceRequested ? (
              <Field label={"Insured value (USD, max $" + MAX_INSURED_VALUE_USD + ")"}>
                <Input
                  value={forwardForm.insuredValue}
                  onChangeText={onQuoteField("insuredValue")}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                />
              </Field>
            ) : null}
            <Text className="text-xs leading-4 text-muted-foreground">
              The cost of these extras is already included in every rate below.
            </Text>
          </View>

          <View className="gap-3 rounded-lg border border-border bg-background p-3">
            <View className="flex-row items-center justify-between gap-3">
              <View className="min-w-0 flex-1">
                <Text className="text-sm font-medium text-foreground">Shipping rates</Text>
                <Text className="text-xs text-muted-foreground">Sandbox rates. Labels are not purchased yet.</Text>
              </View>
              <Button variant="outline" size="sm" loading={quoteRates.isPending} onPress={getRates}>
                Get Rates
              </Button>
            </View>

            {forwardRates.length ? (
              <View className="gap-2">
                {forwardRates.map((rate) => {
                  const isSelected = selectedRateId === rate.optionId;

                  return (
                    <Pressable
                      key={rate.optionId}
                      onPress={() => setSelectedRateId(rate.optionId)}
                      className={
                        isSelected
                          ? "flex-row items-center justify-between gap-3 rounded-lg border-2 border-primary bg-card p-3"
                          : "flex-row items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
                      }
                    >
                      <View className="min-w-0 flex-1">
                        <Text className="font-medium text-foreground">
                          {rate.carrierName || rate.carrier} · {rate.serviceName || rate.serviceId}
                        </Text>
                        <Text className="text-xs text-muted-foreground">
                          {rate.estimatedDeliveryDays == null
                            ? "Delivery estimate unavailable"
                            : rate.estimatedDeliveryDays + " day(s)"}
                        </Text>
                        {rate.trackingIncluded || rate.insuranceRequested ? (
                          <Text className="mt-1 text-xs text-muted-foreground">
                            {[
                              rate.trackingIncluded ? "Tracking included" : null,
                              rate.insuranceRequested
                                ? "Insured " + formatMoneyFromCents(rate.insuredValueCents)
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </Text>
                        ) : null}
                      </View>
                      <Text className="font-semibold text-foreground">
                        {formatMoneyFromCents(rate.totalAmount?.amount)}
                      </Text>
                    </Pressable>
                  );
                })}

                {/* El recargo no viene dentro de las tarifas pero se cobra
                    igual, asi que se enseña el total antes de elegir: ver un
                    precio y pagar otro es lo que no puede pasar. */}
                {immediateFeeCents > 0 && selectedRate ? (
                  <View className="gap-1 rounded-lg border border-border bg-card p-3">
                    <View className="flex-row items-center justify-between gap-3">
                      <Text className="text-sm text-muted-foreground">Shipping</Text>
                      <Text className="text-sm text-foreground">
                        {formatMoneyFromCents(selectedRate.totalAmount?.amount)}
                      </Text>
                    </View>
                    <View className="flex-row items-center justify-between gap-3">
                      <Text className="text-sm text-muted-foreground">Immediate forwarding fee</Text>
                      <Text className="text-sm text-foreground">{formatMoneyFromCents(immediateFeeCents)}</Text>
                    </View>
                    <View className="mt-1 flex-row items-center justify-between gap-3 border-t border-border pt-2">
                      <Text className="text-sm font-medium text-foreground">Total</Text>
                      <Text className="text-base font-semibold text-foreground">
                        {formatMoneyFromCents(Number(selectedRate.totalAmount?.amount || 0) + immediateFeeCents)}
                      </Text>
                    </View>
                  </View>
                ) : null}

                <Button loading={selectRate.isPending} disabled={!selectedRateId} onPress={continueWithRate}>
                  Continue with selected rate
                </Button>
              </View>
            ) : (
              <Text className="text-xs text-muted-foreground">No rates loaded yet.</Text>
            )}
          </View>

          <Notice tone="sky">
            For shipments outside the United States, contact your center
            {supportEmail ? " at " + supportEmail : ""}.
          </Notice>
        </Modal>

        {/* Cartas: el mismo flujo que el portal web. El cliente no cotiza, pide
            el reenvio y el centro confirma el franqueo al pesar el sobre. */}
        {isLetter ? (
          <LetterForwardSheet
            key={letterForwardKey}
            visible={letterForwardOpen}
            onClose={() => setLetterForwardOpen(false)}
            mailItems={[item]}
            onCompleted={onRefresh}
          />
        ) : null}

        <Modal
          visible={pickupOpen}
          onClose={() => setPickupOpen(false)}
          title="Schedule Pickup"
          footer={
            <>
              <Button loading={createRequest.isPending} onPress={submitPickup}>
                Submit
              </Button>
              <Button variant="outline" onPress={() => setPickupOpen(false)}>
                Cancel
              </Button>
            </>
          }
        >
          <Field label="Pickup window (optional)">
            <Input placeholder="e.g. 9:00-11:00" value={pickupWindow} onChangeText={setPickupWindow} />
          </Field>
        </Modal>

        <Modal
          visible={discardOpen}
          onClose={() => setDiscardOpen(false)}
          title="Discard this item?"
          description="A request is sent to the center confirming it can be safely destroyed."
          footer={
            <>
              <Button variant="destructive" loading={createRequest.isPending} onPress={submitDiscard}>
                Confirm Discard
              </Button>
              <Button variant="outline" onPress={() => setDiscardOpen(false)}>
                Cancel
              </Button>
            </>
          }
        >
          <Notice tone="rose">
            The item is not deleted right away. Staff must review and complete the request.
          </Notice>
        </Modal>

        <Modal
          visible={rejectOpen}
          onClose={() => setRejectOpen(false)}
          title="This item is not yours?"
          description="Staff will review the photo and the assignment. The item stays auditable while they decide whether to reassign or discard it."
          footer={
            <>
              <Button loading={rejectAssignment.isPending} onPress={() => rejectAssignment.mutate()}>
                Send to Staff
              </Button>
              <Button variant="outline" onPress={() => setRejectOpen(false)}>
                Cancel
              </Button>
            </>
          }
        >
          <Notice tone="amber">
            Use this only if the item belongs to another tenant or was assigned to your mailbox by mistake.
          </Notice>
        </Modal>
      </View>
    </View>
  );
}

export default function MailItemDetailScreen() {
  const { id } = useLocalSearchParams();
  const queryClient = useQueryClient();
  const markedRef = useRef(null);
  // Cuenta las mutaciones en vuelo sin tener que subir estado desde
  // ActionsCard, que es donde viven. Va aqui arriba porque mas abajo hay
  // returns condicionales y un hook no puede quedar detras de ellos.
  const isBusy = useIsMutating() > 0;
  const [viewerUri, setViewerUri] = useState(null);
  const [pdfMedia, setPdfMedia] = useState(null);

  const query = useQuery({
    queryKey: ["client-mail-item", id],
    queryFn: async () => {
      const response = await api.get("/client/mail-items/" + id);
      return response.data;
    },
    enabled: Boolean(id),
  });

  const serviceNoticesQuery = useQuery({
    queryKey: ["client-service-notices"],
    queryFn: async () => {
      const response = await api.get("/client/service-notices");
      return response.data || {};
    },
    staleTime: 5 * 60_000,
  });

  const mailbox = query.data?.mailbox || "";
  const item = query.data?.item || null;
  const availableActions = query.data?.availableActions || null;
  const serviceRequests = Array.isArray(item?.serviceRequests) ? item.serviceRequests : [];

  const timeline = useMemo(() => (item ? buildTimeline(item) : []), [item]);
  const visibleMedia = useMemo(() => getVisibleMedia(item), [item]);
  const hiddenScanCount = useMemo(
    () => Math.max(getScanMedia(item).length - visibleMedia.filter((m) => m.kind === "SCAN_PDF").length, 0),
    [item, visibleMedia]
  );

  const primaryPhoto = useMemo(
    () => visibleMedia.find((media) => (media?.mimeType || "").startsWith("image/") && (media?.signedUrl || media?.url)) || null,
    [visibleMedia]
  );
  const galleryMedia = useMemo(
    () => visibleMedia.filter((media) => media?.id !== primaryPhoto?.id),
    [visibleMedia, primaryPhoto]
  );

  const completedScanRequest = useMemo(
    () => findRequest(serviceRequests, (r) => r?.type === "SCAN" && r?.status === "COMPLETED", "completedAt"),
    [serviceRequests]
  );
  const approvableForwardRequest = useMemo(
    () => findRequest(serviceRequests, (r) => r?.type === "FORWARD" && r?.status === "AWAITING_CLIENT_APPROVAL"),
    [serviceRequests]
  );
  /**
   * Reenvio esperando a que el cliente acepte el seguimiento.
   *
   * Se exige que siga sin aceptarse: una vez aceptado, la solicitud sigue su
   * curso y la tarjeta no debe volver a pedir nada.
   */
  const trackingApprovalRequest = useMemo(
    () =>
      findRequest(
        serviceRequests,
        (r) =>
          r?.type === "FORWARD"
          && r?.status === "AWAITING_CLIENT_APPROVAL"
          && r?.forwardDetails?.trackingApprovalRequestedAt
          && !r?.forwardDetails?.trackingApprovedAt,
        "createdAt"
      ),
    [serviceRequests]
  );
  const readyToShipForwardRequest = useMemo(
    () => findRequest(serviceRequests, (r) => r?.type === "FORWARD" && r?.status === "READY_TO_SHIP"),
    [serviceRequests]
  );
  /**
   * Reenvio pendiente de pago por el cliente.
   *
   * Solo ocurre con paquetes: ahi el cliente elige la tarifa y acepta el
   * importe en el momento, porque el peso ya esta registrado. Una carta o un
   * sobre se mandan como peticion sin cotizar, asi que nada mas crearla
   * cumplia el filtro (OPEN + NOT_STARTED) y aparecia una tarjeta de pago con
   * "Accepted quote: -" sin haber importe alguno.
   *
   * Se exige ademas un importe real: sin tarifa aceptada no hay nada que
   * pagar, sea cual sea el tipo.
   */
  const payableForwardRequest = useMemo(
    () =>
      findRequest(serviceRequests, (r) => {
        if (r?.type !== "FORWARD" || item?.type !== "PACKAGE") return false;

        const paymentStatus = r?.forwardDetails?.paymentStatus || "NOT_STARTED";
        const amount = Number(r?.forwardDetails?.quotedAmountCents || 0);

        return (
          ["OPEN", "PROCESSING"].includes(r?.status)
          && PAYABLE_PAYMENT_STATUSES.includes(paymentStatus)
          && amount > 0
        );
      }),
    [serviceRequests, item?.type]
  );

  const lastAction = timeline.length > 0 ? timeline[timeline.length - 1] : null;

  // Al abrir el item, marca como leídas sus notificaciones pendientes.
  useEffect(() => {
    if (!item?.id || markedRef.current === item.id) return;
    markedRef.current = item.id;

    // Abrir el item ya lo marca como visto en el servidor, pero las listas
    // siguen con la respuesta anterior: sin esto el aviso de la carpeta se
    // quedaba puesto hasta que el cliente tiraba de la lista para recargar.
    queryClient.invalidateQueries({ queryKey: ["client-mail-items"] });

    (async () => {
      try {
        const response = await api.get("/client/notifications", { params: { unreadOnly: true } });
        const notifications = Array.isArray(response.data?.items) ? response.data.items : [];
        const matching = notifications.filter((notification) => notification?.data?.mailItemId === item.id);

        if (matching.length === 0) return;

        await Promise.all(matching.map((n) => api.patch("/client/notifications/" + n.id + "/read")));
        queryClient.invalidateQueries({ queryKey: ["client-notifications"] });
      } catch (error) {
        console.warn("Unable to mark mail item notifications as read", error);
      }
    })();
  }, [item?.id, queryClient]);

  if (query.isLoading) {
    return (
      <View className="flex-1 gap-4 bg-background p-4">
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-40 w-full" />
      </View>
    );
  }

  if (query.isError) {
    return (
      <View className="flex-1 bg-background p-4">
        <EmptyState title="Unable to load mail item" description={formatErrorMessage(query.error)} />
      </View>
    );
  }

  if (!item) {
    return (
      <View className="flex-1 bg-background p-4">
        <EmptyState title="Not found" description="Mail item detail was not returned." />
      </View>
    );
  }

  const statusDisplay = getItemStatusDisplay(item);
  // Si no coincide con el estado del item es porque manda una solicitud
  // rechazada o cancelada ("Forward Rejected").
  const closedRequest = Boolean(item.status) && statusDisplay.label !== formatStatusDisplay(item.status);
  const itemTitle = "Item " + (item.itemCode || item.id);
  // El mas reciente arriba, como en el diseño.
  const history = [...timeline].reverse().map((event, index) => ({
    ...event,
    key: index,
    time: formatEventTime(event.at),
  }));
  const photoUrl = primaryPhoto?.signedUrl || primaryPhoto?.url;
  const serviceNotices = normalizeBasicPlanServiceNotices(serviceNoticesQuery.data?.basicPlanServiceNotices);
  const supportEmail = serviceNoticesQuery.data?.supportEmail || "";

  return (
    <>
      <Stack.Screen
        options={{
          title: itemTitle,
          headerTitleAlign: "center",
          headerTitle: () => <ItemHeaderTitle title={itemTitle} />,
          headerTintColor: brand.palette.ink,
          headerStyle: { backgroundColor: "#ffffff" },
          headerShadowVisible: true,
        }}
      />

      {/* Al enviar una solicitud el estado del item cambia, pero los datos
          tardan en llegar. Sin esto la pantalla se quedaba igual y parecia que
          no habia pasado nada. `onSuccess` espera al refetch, asi que la capa
          se retira cuando los datos ya estan actualizados. */}
      {isBusy ? (
        <View className="absolute inset-0 z-50 items-center justify-center bg-background/70">
          <View className="items-center gap-3 rounded-lg border border-border bg-card px-6 py-5">
            <ActivityIndicator size="large" color={brand.primaryColor} />
            <Text className="text-sm font-medium text-foreground">Updating…</Text>
          </View>
        </View>
      ) : null}

      <ScrollView
        className="flex-1 bg-canvas"
        contentContainerClassName="gap-5 px-4 pb-24 pt-6"
        refreshControl={<RefreshControl refreshing={query.isFetching && !query.isLoading} onRefresh={query.refetch} />}
      >
        {item.storageFeeNotice ? (
          <Notice tone={item.storageFeeNotice.severity === "danger" ? "rose" : "amber"}>
            {item.storageFeeNotice.title + "\n" + item.storageFeeNotice.message}
          </Notice>
        ) : null}

        <DetailCard>
          <View className="relative w-full bg-media" style={{ aspectRatio: 4 / 3 }}>
            {photoUrl ? (
              <Pressable className="h-full w-full" onPress={() => setViewerUri(photoUrl)}>
                <Image source={{ uri: photoUrl }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
              </Pressable>
            ) : (
              <View className="h-full w-full items-center justify-center gap-3 px-6">
                <ImageIcon size={44} color={brand.palette.glyph} />
                <Text className="text-center font-hanken-medium text-[14px] text-ink/60">
                  {hiddenScanCount > 0 ? "Scan files will appear here after completion." : "No package photo available"}
                </Text>
              </View>
            )}

            <View className="absolute right-3 top-3 items-end gap-1.5">
              <StatusPill
                status={item.status}
                closedRequest={closedRequest}
                label={item.status ? statusDisplay.label : formatStatusDisplay("UNKNOWN")}
              />
              <ViewPill label={getCurrentStatusLabel(item)} />
            </View>
          </View>
        </DetailCard>

        <DetailCard className="p-5">
          <CardHeading className="mb-1">Item Details</CardHeading>
          <DetailRow label="Mailbox">
            {mailbox ? <MailboxChip>{mailbox}</MailboxChip> : <Text className="font-hanken-medium text-[14px] text-ink">-</Text>}
          </DetailRow>
          <DetailRow label="Type">
            <TypeChip type={item.type} label={getMailTypeLabel(item.type)} />
          </DetailRow>
          {/* En cartas el peso no es del item: lo que se factura es el sobre
              del centro, y ese peso lo pone el centro al prepararlo. */}
          {item.type === "LETTER" ? null : <DetailRow label="Weight" value={formatItemWeight(item)} />}
          {/* Sin remitente no se pinta la fila: "Not provided" ocupa sitio
              sin decir nada, igual que carrier y tracking. */}
          {hasDisplayValue(item.senderName) ? <DetailRow label="Sender" value={item.senderName} /> : null}
          {hasDisplayValue(item.carrier) ? <DetailRow label="Carrier" value={item.carrier} /> : null}
          {hasDisplayValue(item.trackingNumber) ? <DetailRow label="Tracking" value={item.trackingNumber} /> : null}
          <DetailRow label="Last action" value={lastAction?.title || formatStatusDisplay(item.status || "Received")} />
          <DetailRow label="Assigned" value={formatDate(item.receivedAt || item.createdAt)} last />
        </DetailCard>

        {availableActions ? (
          <ActionsCard
            item={item}
            mailItemId={item.id}
            availableActions={availableActions}
            serviceNotices={serviceNotices}
            supportEmail={supportEmail}
            onRefresh={() => query.refetch()}
          />
        ) : null}

        {/* Solo si el rechazo es lo ultimo que paso: si el cliente ya volvio a
            pedirlo, ensenar el rechazo viejo confunde sobre el estado actual. */}
        {lastAction?.kind === "SR_REJECTED" ? (
          <NoticeCard
            tone="rose"
            title={formatStatusDisplay(lastAction.sr?.type || "Request") + " request declined"}
            description={formatDate(lastAction.at)}
          >
            <Text className="font-hanken text-[14px] leading-6 text-ink">{lastAction.description}</Text>
          </NoticeCard>
        ) : null}

        {completedScanRequest?.scanDetails ? (
          <NoticeCard tone="emerald" title="Scan Completed" description="Your scan is ready to view.">
            <SummaryLine label="Pages" value={completedScanRequest.scanDetails.pageCount || 0} />
            <SummaryLine label="Included" value={completedScanRequest.scanDetails.includedPages || 0} />
            <SummaryLine label="Extra" value={completedScanRequest.scanDetails.extraPages || 0} />
            <SummaryLine label="Paid" value={formatMoneyFromCents(completedScanRequest.scanDetails.quotedAmountCents)} />
            <SummaryLine label="Paid At" value={formatDate(completedScanRequest.scanDetails.paidAt)} />
            {completedScanRequest.scanDetails.quoteNotes ? (
              <Text className="mt-2 font-hanken text-[14px] text-ink/60">{completedScanRequest.scanDetails.quoteNotes}</Text>
            ) : null}
          </NoticeCard>
        ) : null}

        {payableForwardRequest?.forwardDetails ? (
          <ForwardPaymentCard
            request={payableForwardRequest}
            mailItemId={item.id}
            onRefresh={() => query.refetch()}
          />
        ) : null}

        {/* Esperando a que el cliente acepte el seguimiento. Va antes que la
            tarjeta de cotizacion porque es la unica de las dos que le pide
            algo, y sin responderla el reenvio no avanza. */}
        {trackingApprovalRequest ? (
          <TrackingApprovalCard request={trackingApprovalRequest} onRefresh={() => query.refetch()} />
        ) : null}

        {!payableForwardRequest && !trackingApprovalRequest && approvableForwardRequest?.forwardDetails ? (
          <NoticeCard tone="amber" title="Forward Quote Ready">
            <SummaryLine label="Carrier" value={approvableForwardRequest.forwardDetails.quotedCarrier} />
            <SummaryLine label="Service" value={approvableForwardRequest.forwardDetails.quotedService} />
            <SummaryLine label="Quote" value={formatMoneyFromCents(approvableForwardRequest.forwardDetails.quotedAmountCents)} />
            <SummaryLine label="Quoted At" value={formatDate(approvableForwardRequest.forwardDetails.quotedAt)} />
          </NoticeCard>
        ) : null}

        {!approvableForwardRequest && readyToShipForwardRequest?.forwardDetails ? (
          <NoticeCard tone="emerald" title="Forward Approved" description="Paid. The center can ship it.">
            <SummaryLine label="Carrier" value={readyToShipForwardRequest.forwardDetails.quotedCarrier} />
            <SummaryLine label="Service" value={readyToShipForwardRequest.forwardDetails.quotedService} />
            <SummaryLine label="Paid" value={formatMoneyFromCents(readyToShipForwardRequest.forwardDetails.quotedAmountCents)} />
            <SummaryLine label="Paid At" value={formatDate(readyToShipForwardRequest.forwardDetails.paidAt)} />
          </NoticeCard>
        ) : null}

        {galleryMedia.length > 0 ? (
          <DetailCard className="gap-3 p-5">
            <CardHeading>Additional media</CardHeading>
            {galleryMedia.map((media, index) => {
              const url = media.signedUrl || media.url || "";
              const isImage = (media.mimeType || "").startsWith("image/");
              const isPdf = isPdfMedia(media);

              return (
                <Pressable
                  key={media.id || index}
                  disabled={!url}
                  onPress={() => {
                    // Fotos y PDFs se ven dentro de la app; cualquier otro
                    // archivo sigue abriendose fuera, que es quien sabe mostrarlo.
                    if (isImage) setViewerUri(url);
                    else if (isPdf) setPdfMedia(media);
                    else WebBrowser.openBrowserAsync(url);
                  }}
                  className="overflow-hidden rounded-[10px] border border-ink/[0.12]"
                >
                  {isImage && url ? (
                    <Image source={{ uri: url }} style={{ width: "100%", height: 160 }} contentFit="cover" />
                  ) : isPdf && url ? (
                    <PdfThumbnail media={media} />
                  ) : (
                    <View className="h-40 items-center justify-center bg-media">
                      <Text className="font-hanken-medium text-[14px] text-ink/60">{media.kind || "FILE"}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </DetailCard>
        ) : null}

        <DetailCard className="p-5">
          <CardHeading className="mb-4">History</CardHeading>
          {history.length === 0 ? (
            <Text className="font-hanken text-[14px] text-ink/60">No events yet.</Text>
          ) : (
            <Timeline
              events={history}
              renderExtra={(event) => {
                const requestColor = event.sr?.status ? requestStatusColor(event.sr.status) : null;

                return (
                  <>
                    {requestColor ? (
                      <Badge variant="outline" className={"mt-1.5 " + requestColor.container} labelClassName={requestColor.label}>
                        {formatStatusDisplay(event.sr.status)}
                      </Badge>
                    ) : null}

                    {event.sr?.type === "PICKUP" && hasDisplayValue(event.sr.pickupDetails?.pickupWindow) ? (
                      <TimelineDetails>
                        <TimelineDetailLine>Pickup Window: {event.sr.pickupDetails.pickupWindow}</TimelineDetailLine>
                      </TimelineDetails>
                    ) : null}

                    {event.sr?.type === "FORWARD" && event.sr.forwardDetails ? (
                      <TimelineDetails>
                        {hasDisplayValue(event.sr.forwardDetails.destinationName) ? (
                          <TimelineDetailLine>Recipient: {event.sr.forwardDetails.destinationName}</TimelineDetailLine>
                        ) : null}
                        {hasDisplayValue(event.sr.forwardDetails.quotedCarrier) ? (
                          <TimelineDetailLine>Carrier: {event.sr.forwardDetails.quotedCarrier}</TimelineDetailLine>
                        ) : null}
                        {event.sr.forwardDetails.quotedAmountCents != null ? (
                          <TimelineDetailLine>
                            Quote: {formatMoneyFromCents(event.sr.forwardDetails.quotedAmountCents)}
                          </TimelineDetailLine>
                        ) : null}
                        {hasDisplayValue(event.sr.forwardDetails.trackingNumber) ? (
                          <TimelineDetailLine>Tracking: {event.sr.forwardDetails.trackingNumber}</TimelineDetailLine>
                        ) : null}
                      </TimelineDetails>
                    ) : null}

                    {event.sr?.type === "SCAN" && event.sr.scanDetails?.pageCount > 0 ? (
                      <TimelineDetails>
                        <TimelineDetailLine>Pages: {event.sr.scanDetails.pageCount}</TimelineDetailLine>
                        {event.sr.scanDetails.quotedAmountCents != null ? (
                          <TimelineDetailLine>
                            Quote: {formatMoneyFromCents(event.sr.scanDetails.quotedAmountCents)}
                          </TimelineDetailLine>
                        ) : null}
                      </TimelineDetails>
                    ) : null}
                  </>
                );
              }}
            />
          )}
        </DetailCard>
      </ScrollView>

      <ImageViewer uri={viewerUri} onClose={() => setViewerUri(null)} />
      <PdfViewer
        media={pdfMedia}
        title={"Scan · " + itemTitle}
        fileName={(item.itemCode ? "Item-" + item.itemCode : "Item") + "-scan.pdf"}
        onClose={() => setPdfMedia(null)}
      />
    </>
  );
}
