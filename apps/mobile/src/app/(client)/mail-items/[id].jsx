import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Switch, Text, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Flag, ImageIcon, ScanLine, Store, Trash2, Truck } from "lucide-react-native";

import { api } from "@/lib/api";
import { brand } from "@/lib/brand";
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
import {
  addressErrorMessage,
  describeAddressVerification,
  isAddressUsableForForwarding,
  isVerifiedCheck,
  sameAddress,
  verifyPayload,
} from "@/lib/address-verification";
import {
  applySuggestedToForwardForm,
  hasForwardFormChanges,
  invalidatesAddressCheck,
  isStaffPreparedForward,
  verifyDraftFromForwardForm,
} from "@/lib/forward-form";
import { chargeFromForwardDetails, chargeFromRate, chargeRows, SHIPPING_AND_HANDLING_LABEL } from "@/lib/price-display";
import { describeForwardStage, labelStatusText, latestForwardRequest } from "@/lib/forward-stage";
import {
  buildShippingOptions,
  describeForwardingOptionsError,
  insuranceAvailableFor,
  INSURED_VALUE_MAX_USD,
  INSURED_VALUE_MIN_USD,
  insuranceUnavailableMessage,
  QUOTE_INVALID_MESSAGE,
  rateExtras,
  rateMatchesOptions,
  readQuoteResponse,
  shippingOptionsProblem,
} from "@/lib/forwarding-options";
import { FORWARDING_ADDRESSES_ENDPOINT, FORWARDING_ADDRESSES_KEY, findDefaultAddress, forwardFieldsFromAddress } from "@/lib/forwarding-addresses";
import {
  billingHold,
  FORWARD_PAYMENT_STRIPE_CHECKOUT,
  FORWARD_PAYMENT_UNAVAILABLE,
  FORWARD_PAYMENT_UNKNOWN,
  FORWARD_PAYMENT_ZOHO_HOSTED,
  forwardPaymentMode,
  itemActions,
} from "@/lib/capabilities";
import { useCapabilities } from "@/lib/use-capabilities";
import ZohoForwardPaymentCard from "@/components/common/zoho-forward-payment-card";
import StripeForwardPayment from "@/components/common/stripe-forward-payment";
import ScanApprovalCard from "@/components/common/scan-approval-card";
import { findScanAwaitingApproval } from "@/lib/scan-approval";
import { shouldTrackScanPayment } from "@/lib/scan-payment";
import ScanPaymentCard from "@/components/common/scan-payment-card";
import { describePickupGroup } from "@/lib/pickup-group";
import { describePaidForwardProgress, findPaidForwardAwaitingLabel, shouldPollForLabel } from "@/lib/forward-progress";
import { applyReadyPickup, PICKUP_DIALOG_DESCRIPTION, PICKUP_READY_CONFIRMATION, PICKUP_READY_TITLE } from "@/lib/pickup-ready";
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
import { confirmDiscard, Modal, Notice } from "@/components/ui/modal";
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

function SummaryLine({ label, value }) {
  if (!hasDisplayValue(value)) return null;

  return (
    <Text className="font-brand text-[14px] text-ink">
      <Text className="font-brand-semibold">{label}: </Text>
      {value}
    </Text>
  );
}

/** Lo cobrado (paymentAmount del backend); sin el, nada: no se ensena el franqueo como si fuera el total. */
function paidAmountLabel(details) {
  const total = chargeFromForwardDetails(details).total;
  return total != null ? formatMoneyFromCents(total) : null;
}

/**
 * Resumen del reenvio de la pieza: en que punto esta y lo que la API dice de su
 * precio, pago, etiqueta y seguimiento. Solo campos que el backend devuelve; el
 * cargo de reenvio y la fecha de despacho no viajan en forwardDetails
 * (f7c677a), asi que no se pintan. La gestion interna nunca va en una linea.
 */
function ForwardSummaryCard({ request }) {
  const stage = describeForwardStage(request);
  if (!stage) return null;
  const details = request.forwardDetails || {};
  const charge = chargeFromForwardDetails(details);
  const label = labelStatusText(details);

  return (
    <DetailCard className="gap-1.5 p-5">
      <CardHeading className="mb-1">Forwarding</CardHeading>
      <Notice tone={stage.tone}>{stage.description ? stage.title + ". " + stage.description : stage.title}</Notice>
      <View className="mt-2 gap-1">
        <SummaryLine label="Requested" value={formatDate(request.createdAt)} />
        <SummaryLine label="Carrier" value={[details.quotedCarrier, details.quotedService].filter(Boolean).join(" · ") || null} />
        <SummaryLine label={"Quoted " + SHIPPING_AND_HANDLING_LABEL} value={charge.quoted != null ? formatMoneyFromCents(charge.quoted) : null} />
        <SummaryLine label="Reconfirmed price" value={charge.reconfirmed != null ? formatMoneyFromCents(charge.reconfirmed) : null} />
        <SummaryLine label="Total charged" value={charge.total != null ? formatMoneyFromCents(charge.total) : null} />
        <SummaryLine label="Payment" value={details.paymentStatus ? formatStatusDisplay(details.paymentStatus) : null} />
        <SummaryLine label="Paid at" value={details.paidAt ? formatDate(details.paidAt) : null} />
        <SummaryLine label="Label" value={label} />
        <SummaryLine label="Tracking" value={details.trackingNumber || null} />
      </View>
      {stage.action === "update-payment" ? (
        <Button variant="outline" className="mt-2" onPress={() => router.push("/billing")}>
          Review payment method
        </Button>
      ) : null}
    </DetailCard>
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

/**
 * La recogida de esta pieza y, si el centro agrupo varias en una, cuales son.
 * Cada otra pieza abre su propio detalle (el backend la vuelve a comprobar
 * contra el buzon del cliente). Ver lib/pickup-group.
 */
function PickupRequestCard({ group }) {
  return (
    <DetailCard className="p-5">
      <CardHeading className="mb-1">Pickup Request</CardHeading>
      <DetailRow label="Status" value={group.statusLabel} last={!group.grouped} />

      {group.grouped ? (
        <View className="mt-3">
          <SectionLabel>{`Included Mail Items (${group.items.length})`}</SectionLabel>
          {group.items.map((entry, index) => {
            const label = getMailTypeLabel(entry.type) + (entry.itemCode ? " #" + entry.itemCode : "");
            const last = index === group.items.length - 1;

            if (entry.isCurrent) {
              return (
                <DetailRow key={entry.id} label={label} last={last}>
                  <Text className="font-brand-medium text-[14px] text-ink/60">This item</Text>
                </DetailRow>
              );
            }

            return (
              <Pressable
                key={entry.id}
                accessibilityRole="button"
                accessibilityLabel={"Open " + label}
                onPress={() => router.push({ pathname: "/mail-items/[id]", params: { id: entry.id } })}
                className="active:opacity-70"
              >
                <DetailRow label={label} last={last}>
                  <View className="flex-row items-center gap-1">
                    <Text className="font-brand-medium text-[14px] text-ink">{formatStatusDisplay(entry.status)}</Text>
                    <ChevronRight size={16} color={brand.palette.glyph} />
                  </View>
                </DetailRow>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </DetailCard>
  );
}

function ToggleRow({ label, description, value, onValueChange, disabled = false }) {
  return (
    <View
      className={
        disabled
          ? "flex-row items-start justify-between gap-3 rounded-lg border border-border bg-muted p-3"
          : "flex-row items-start justify-between gap-3 rounded-lg border border-border bg-card p-3"
      }
    >
      <View className="min-w-0 flex-1">
        <Text className={disabled ? "text-sm font-medium text-muted-foreground" : "text-sm font-medium text-foreground"}>{label}</Text>
        <Text className="mt-1 text-xs leading-4 text-muted-foreground">{description}</Text>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        accessibilityLabel={label}
        accessibilityState={{ checked: value, disabled }}
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
 * Como se paga lo dice GET /client/capabilities (forwarding.checkout y
 * forwarding.methods). Stripe y Zoho son flujos distintos, cada uno en su
 * componente; lo comun (recotizacion, payment-status, candado contra dobles
 * cobros) esta en lib/forward-payment. Ninguno da un pago por bueno sin
 * payment-status del backend.
 */
function ForwardPaymentCard({ request, mailItemId, onRefresh }) {
  const details = request.forwardDetails || {};
  const needsAuthentication = details.paymentStatus === "AUTHENTICATION_REQUIRED";

  const capabilities = useCapabilities();
  const mode = forwardPaymentMode(capabilities);
  const waitingForCapabilities = !capabilities.known && capabilities.isLoading;

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
      <SummaryLine label={SHIPPING_AND_HANDLING_LABEL} value={formatMoneyFromCents(details.quotedAmountCents)} />
      <SummaryLine label="Payment" value={formatStatusDisplay(details.paymentStatus)} />

      {needsAuthentication ? (
        <Notice tone="amber" className="mt-2">
          Your card is fine, but the bank needs you to confirm this charge. Tap below to finish it.
        </Notice>
      ) : null}

      {waitingForCapabilities ? (
        <Button className="mt-3" loading disabled>
          Pay now
        </Button>
      ) : mode === FORWARD_PAYMENT_STRIPE_CHECKOUT ? (
        <StripeForwardPayment request={request} mailItemId={mailItemId} capabilities={capabilities} onRefresh={onRefresh} />
      ) : mode === FORWARD_PAYMENT_ZOHO_HOSTED ? (
        <ZohoForwardPaymentCard request={request} capabilities={capabilities} onRefresh={onRefresh} />
      ) : mode === FORWARD_PAYMENT_UNKNOWN ? (
        // Sin capacidades no se adivina el proveedor: ni Stripe ni Zoho.
        <View className="mt-2 gap-2">
          <Notice tone="amber">We could not load the payment options for your account.</Notice>
          <Button variant="outline" onPress={() => capabilities.refetch()}>
            Try again
          </Button>
        </View>
      ) : mode === FORWARD_PAYMENT_UNAVAILABLE ? (
        <Notice tone="amber" className="mt-2">
          Online payments are not available for this account. Please contact your center.
        </Notice>
      ) : null}
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

      <Text className="mt-2 font-brand text-[14px] leading-6 text-ink">
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

function ActionsCard({ item, mailItemId, availableActions, serviceNotices, supportEmail, onRefresh, onPickupReady }) {
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
  // El entorno que devolvio la cotizacion: sandbox se avisa, produccion no.
  const [ratesEnvironment, setRatesEnvironment] = useState("");
  // Sin tarifas para estas opciones (422 FORWARDING_NO_COMPATIBLE_RATES o
  // INSURANCE_NOT_AVAILABLE_FOR_PACKAGES): por que, y si se puede ofrecer
  // "Turn on Add Tracking". Es un estado vacio, no un error.
  const [quoteEmpty, setQuoteEmpty] = useState(null);
  // Las opciones con las que se pidio la cotizacion en pantalla: la tarifa
  // elegida tiene que corresponder con ellas para poder seguir.
  const [quotedOptions, setQuotedOptions] = useState(null);

  const isLetter = item?.type === "LETTER";
  // Cartas y sobres grandes los prepara el centro (lib/forward-form); los paquetes cotiza el cliente.
  const staffPrepared = isStaffPreparedForward(item?.type);
  // Seguro adicional: ni paquetes ni sobres grandes lo admiten (lib/forwarding-options).
  const insuranceAllowed = insuranceAvailableFor(item?.type);

  // Cada cambio de destino deja atras la cotizacion en curso: su respuesta,
  // si llega despues, es de la direccion anterior.
  const quoteGeneration = useRef(0);

  const clearRates = () => {
    quoteGeneration.current += 1;

    // Se llama en cada pulsación, así que conviene no re-renderizar de balde.
    if (!forwardQuoteId && forwardRates.length === 0 && !selectedRateId && !quoteEmpty && !quotedOptions) return;

    setForwardQuoteId("");
    setForwardRates([]);
    setSelectedRateId("");
    setImmediateFeeCents(0);
    setRatesEnvironment("");
    setQuoteEmpty(null);
    setQuotedOptions(null);
  };

  /**
   * Cambiar la direccion, Add Tracking, Add Insurance o el valor declarado
   * cambia que servicios valen y cuanto cuestan: la cotizacion en pantalla y la
   * tarifa elegida dejan de valer (y una respuesta que llegue tarde se ignora).
   * Las opciones que eligio el cliente se quedan como estan.
   */
  const onQuoteField = (field, value) => {
    clearRates();
    // Otra direccion: lo que dijo el transportista de la anterior ya no vale.
    if (invalidatesAddressCheck(field)) setAddressCheck(null);
    setForwardForm((current) => ({ ...current, [field]: value }));
  };

  /**
   * Check Address: la validacion del backend (Pitney), la misma que usa la hoja
   * de cartas y Settings. No cambia nada del formulario salvo que el cliente
   * elija la correccion sugerida.
   */
  const [addressCheck, setAddressCheck] = useState(null);
  const checkAddress = useMutation({
    mutationFn: async () => (await api.post("/client/forwarding-addresses/verify", verifyPayload(verifyDraftFromForwardForm(forwardForm)))).data,
    onSuccess: (data) => setAddressCheck(data),
    onError: (error) => {
      setAddressCheck(null);
      Alert.alert("Could not check the address", addressErrorMessage(error, "The address could not be checked right now."));
    },
  });
  const addressValidated = isVerifiedCheck(addressCheck);
  const suggestedAddress =
    addressValidated && addressCheck?.suggested && !sameAddress(addressCheck.suggested, verifyDraftFromForwardForm(forwardForm))
      ? addressCheck.suggested
      : null;

  const useSuggestedAddress = () => {
    if (!suggestedAddress) return;
    // Cambia la direccion: la cotizacion deja de valer, el resto se queda.
    clearRates();
    setForwardForm((current) => applySuggestedToForwardForm(current, suggestedAddress));
    setAddressCheck({ ...addressCheck, suggested: null });
  };

  // Cerrar con algo escrito pregunta antes (components/ui/modal).
  const forwardDirty = hasForwardFormChanges({
    draft: forwardForm,
    emptyDraft: EMPTY_FORWARD,
    trackingRequested: forwardForm.trackingRequested,
    insuranceRequested: forwardForm.insuranceRequested,
    insuredValue: forwardForm.insuredValue,
  });

  /** Cerrar a conciencia: sin cotizacion ni formulario. */
  const discardForward = () => {
    clearRates();
    setAddressCheck(null);
    setForwardForm(EMPTY_FORWARD);
    setForwardOpen(false);
  };

  /**
   * La direccion de reenvio guardada como predeterminada (Settings >
   * Forwarding Addresses), la misma lista y la misma cache que esa pantalla.
   * Antes se usaba la direccion del perfil del cliente, que no es una
   * direccion de reenvio: el formulario se llenaba con datos que el cliente
   * no reconocia y sin enseñarselos antes.
   */
  const addressesQuery = useQuery({
    queryKey: FORWARDING_ADDRESSES_KEY,
    queryFn: async () => (await api.get(FORWARDING_ADDRESSES_ENDPOINT)).data?.items || [],
    enabled: forwardOpen,
  });
  const defaultAddress = findDefaultAddress(addressesQuery.data);
  const hasDefaultAddress = Boolean(defaultAddress?.addressLine1 && defaultAddress?.city);
  // Las guardadas utilizables (con calle y ciudad), para "Select Another Address".
  const savedAddresses = (addressesQuery.data || []).filter((address) => address?.addressLine1 && address?.city);

  const applySavedAddress = (address) => {
    if (!address) return;

    clearRates();
    setAddressCheck(null);
    // El telefono se sustituye aunque falte: el escrito era de otro destino, y
    // si no hay, lo pide la validacion del formulario. Casillas y valor
    // declarado se quedan como estaban.
    setForwardForm((current) => ({ ...current, ...forwardFieldsFromAddress(address) }));
  };

  const useDefaultAddress = () => {
    if (!hasDefaultAddress) return;
    applySavedAddress(defaultAddress);
  };

  const createRequest = useMutation({
    mutationFn: async ({ type, payload }) => {
      const response = await api.post("/client/service-requests", { mailItemId, type, ...(payload || {}) });
      return response.data;
    },
    onSuccess: async (data, { type }) => {
      // La recogida ya esta lista: se pinta con lo que devolvio el servidor
      // antes de recargar el resto.
      if (type === "PICKUP") {
        onPickupReady?.(data);
        Alert.alert(PICKUP_READY_TITLE, PICKUP_READY_CONFIRMATION);
      } else {
        Alert.alert("Request created", "Your request was sent to the center.");
      }
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
    mutationFn: async ({ shippingOptions }) => {
      const response = await api.post("/client/forwarding/quotes", {
        mailItemId,
        shippingOptions,
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
    onSuccess: (data, { generation, shippingOptions }) => {
      if (generation !== quoteGeneration.current) return;
      // Solo las tarifas que son lo que se pidio (el backend ya filtra).
      const result = readQuoteResponse(data, shippingOptions);
      setForwardQuoteId(result.rates.length ? data?.quoteId || "" : "");
      setForwardRates(result.rates);
      setSelectedRateId(result.rates[0]?.optionId || "");
      setImmediateFeeCents(Number(data?.immediateForwardFeeCents || 0));
      setRatesEnvironment(data?.environment || "");
      setQuoteEmpty(result.empty);
      setQuotedOptions(result.rates.length ? shippingOptions : null);
    },
    onError: (error, { generation }) => {
      if (generation !== quoteGeneration.current) return;
      setForwardQuoteId("");
      setForwardRates([]);
      setSelectedRateId("");
      setImmediateFeeCents(0);
      setRatesEnvironment("");
      setQuotedOptions(null);
      const outcome = describeForwardingOptionsError(error, undefined, { itemType: item?.type });
      // Sin tarifas para estas opciones: estado vacio con la explicacion.
      if (outcome.kind === "no-compatible-rates" || outcome.kind === "insurance-unavailable") {
        setQuoteEmpty(outcome);
        return;
      }
      setQuoteEmpty(null);
      Alert.alert("No rates available", outcome.message);
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
      const outcome = describeForwardingOptionsError(error, "Unable to select forwarding rate", { itemType: item?.type });
      // 409: la cotizacion ya no vale. Se borra para que no se pueda seguir con ella.
      if (outcome.kind === "quote-invalid" || outcome.kind === "no-compatible-rates" || outcome.kind === "insurance-unavailable") {
        clearRates();
        // describeForwardingOptionsError ya trae el texto de cada caso (opciones o cotizacion caducada).
        Alert.alert("Get new rates", outcome.message);
        return;
      }
      Alert.alert("Could not select rate", outcome.message);
    },
  });

  const anyPending =
    createRequest.isPending || rejectAssignment.isPending || quoteRates.isPending || selectRate.isPending;

  // Lo que dice el backend para esta pieza; las capacidades del centro solo pueden quitar.
  const capabilities = useCapabilities();
  const actions = itemActions(availableActions, capabilities);
  const active = availableActions?.activeRequests || {};
  const activeNotice = noticeService ? serviceNotices[noticeService] : null;

  const forwardFieldsFilled =
    forwardForm.recipient && forwardForm.address1 && forwardForm.city && forwardForm.state && forwardForm.zip && forwardForm.phone;

  const submitScan = () => {
    if (!actions.canRequestScan) return;
    createRequest.mutate({ type: "SCAN", payload: { chargeConsent: true } });
  };

  const submitPickup = () => {
    if (!actions.canRequestPickup) return;
    createRequest.mutate({ type: "PICKUP", payload: { pickupWindow: pickupWindow || undefined } });
  };

  const submitDiscard = () => {
    if (!actions.canRequestDiscard) return;
    createRequest.mutate({ type: "DISCARD", payload: {} });
  };

  /** Validación común a las dos vías; devuelve false y avisa si algo falta. */
  const forwardFormIsValid = () => {
    if (!forwardFieldsFilled) {
      Alert.alert("Missing details", "Fill in the required forwarding fields.");
      return false;
    }

    const problem = shippingOptionsProblem({ itemType: item?.type, ...forwardForm });
    if (problem) {
      Alert.alert(problem.code === "INSURED_VALUE_INVALID" ? "Check the declared value" : "Insurance unavailable", problem.message);
      return false;
    }

    return true;
  };

  /** Exactamente lo elegido por el cliente (lib/forwarding-options). */
  const currentShippingOptions = () => buildShippingOptions({ itemType: item?.type, ...forwardForm });

  const getRates = () => {
    if (!forwardFormIsValid()) return;
    quoteRates.mutate({ generation: quoteGeneration.current, shippingOptions: currentShippingOptions() });
  };

  const continueWithRate = () => {
    if (!forwardQuoteId || !selectedRateId) {
      Alert.alert("Choose a rate", "Select a shipping rate first.");
      return;
    }
    // La tarifa tiene que ser de la cotizacion de estas mismas opciones; si no,
    // no se sigue (ni se llega a pagar) con ella.
    const options = currentShippingOptions();
    const rate = forwardRates.find((entry) => entry.optionId === selectedRateId);
    if (!quotedOptions || JSON.stringify(quotedOptions) !== JSON.stringify(options) || !rateMatchesOptions(rate, options)) {
      clearRates();
      Alert.alert("Get new rates", QUOTE_INVALID_MESSAGE);
      return;
    }
    selectRate.mutate();
  };

  /** "Turn on Add Tracking": solo cuando el cliente lo pulsa, y no cotiza solo. */
  const enableTracking = () => onQuoteField("trackingRequested", true);

  // Los paquetes se reenvían o se recogen, pero su contenido no se escanea.
  const canScan = item?.type !== "PACKAGE" && actions.canRequestScan;

  const selectedRate = forwardRates.find((rate) => rate.optionId === selectedRateId) || null;

  const openForward = () => {
    if (staffPrepared) {
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
  const forwardAction = actions.canRequestForward ? (
    <ActionButton variant="primary" icon={Truck} disabled={anyPending} onPress={openForward}>
      {isLetter ? "Forward Letter" : staffPrepared ? "Request Forwarding" : "Forward Item"}
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
    actions.canRequestPickup ? (
      <ActionButton icon={Store} disabled={anyPending} onPress={() => setPickupOpen(true)}>
        Pickup
      </ActionButton>
    ) : null,
    // Lo que se pisa con un escaneo en marcha lo quita el backend, pero
    // Discard se aparta aqui: descartar lo que se esta escaneando no tiene
    // sentido aunque el servidor lo permita.
    actions.canRequestDiscard && !active.scan ? (
      <ActionButton icon={Trash2} disabled={anyPending} onPress={() => setDiscardOpen(true)}>
        Discard
      </ActionButton>
    ) : null,
  ].filter(Boolean);

  const primaryAction = forwardAction || scanAction;
  const hasActions = Boolean(primaryAction || secondaryActions.length || actions.canRejectAssignment);

  return (
    <View className="gap-2.5 pt-1">
      {hasActions || active.forward || active.scan || actions.billingRestricted ? (
        <SectionLabel>Actions</SectionLabel>
      ) : null}

      <View className="gap-2.5">
        {actions.billingRestricted ? (
          <Notice tone="amber">
            {availableActions?.reason || billingHold(capabilities)?.reason || "Billing needs attention before requesting services."}
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

            {actions.canRejectAssignment ? (
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
          // Cerrar sin querer no borra nada: el formulario se queda para la
          // proxima vez. "Discard" (si hay cambios) es lo que lo vacia.
          onClose={() => (forwardDirty ? discardForward() : setForwardOpen(false))}
          dirty={forwardDirty}
          busy={quoteRates.isPending || selectRate.isPending}
          title="Request Forwarding"
          description="Set the destination, choose tracking or insurance, and get the shipping rates."
          footer={
            <Button
              variant="outline"
              disabled={quoteRates.isPending || selectRate.isPending}
              onPress={() => (forwardDirty ? confirmDiscard(discardForward) : setForwardOpen(false))}
            >
              Cancel
            </Button>
          }
        >
          {savedAddresses.length > 1 ? (
            <Field label="Select Another Address">
              <Select
                value=""
                onValueChange={(id) => applySavedAddress(savedAddresses.find((address) => address.id === id))}
                options={savedAddresses.map((address) => [address.id, [address.name, address.addressLine1, address.city].filter(Boolean).join(" · ")])}
                placeholder="Choose a saved address"
                title="Saved addresses"
              />
            </Field>
          ) : null}

          {hasDefaultAddress ? (
            <View className="gap-2 rounded-lg border border-border bg-card p-3">
              <Text className="font-brand-bold text-[12px] uppercase tracking-wider text-ink/60">Your default address</Text>
              <View>
                <Text className="font-brand-semibold text-[14px] text-ink">{defaultAddress.name}</Text>
                <Text className="font-brand text-[13px] leading-5 text-ink/70">
                  {[
                    defaultAddress.addressLine1,
                    defaultAddress.addressLine2,
                    [defaultAddress.city, [defaultAddress.state, defaultAddress.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "),
                  ]
                    .filter(Boolean)
                    .join("\n")}
                </Text>
              </View>
              <Button variant="outline" size="sm" disabled={anyPending} onPress={useDefaultAddress}>
                Use this address
              </Button>
              {!String(defaultAddress.phone || "").trim() ? (
                <Notice tone="amber">This address has no phone number. Add one below: the carrier needs it for the label.</Notice>
              ) : null}
              {!isAddressUsableForForwarding(defaultAddress) ? (
                <Notice tone="amber">{describeAddressVerification(defaultAddress.verification).hint}</Notice>
              ) : null}
            </View>
          ) : addressesQuery.isError ? (
            <Notice tone="amber">We could not load your saved addresses. You can enter the address below.</Notice>
          ) : addressesQuery.isSuccess ? (
            <Notice tone="sky">Set Address: you have no saved forwarding address yet. Enter it below.</Notice>
          ) : addressesQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : null}

          <Field label="Recipient">
            <Input value={forwardForm.recipient} onChangeText={(value) => onQuoteField("recipient", value)} />
          </Field>
          <Field label="Address line 1">
            <Input value={forwardForm.address1} onChangeText={(value) => onQuoteField("address1", value)} />
          </Field>
          <Field label="Address line 2 (optional)">
            <Input value={forwardForm.address2} onChangeText={(value) => onQuoteField("address2", value)} />
          </Field>
          <Field label="City">
            <Input value={forwardForm.city} onChangeText={(value) => onQuoteField("city", value)} />
          </Field>
          <Field label="State">
            <Select
              value={forwardForm.state}
              onValueChange={(value) => onQuoteField("state", value)}
              options={US_STATES}
              placeholder="Select state"
              title="State"
            />
          </Field>
          <Field label="ZIP">
            <Input value={forwardForm.zip} onChangeText={(value) => onQuoteField("zip", value)} keyboardType="number-pad" />
          </Field>
          <Field label="Recipient phone">
            <Input value={forwardForm.phone} onChangeText={(value) => onQuoteField("phone", value)} keyboardType="phone-pad" />
          </Field>

          {/* Check Address: validacion del backend. El formulario no se toca;
              solo la correccion sugerida, si el cliente la elige. */}
          <View className="gap-2 rounded-lg border border-border bg-card p-3">
            <Button
              variant="outline"
              loading={checkAddress.isPending}
              disabled={!forwardFieldsFilled || checkAddress.isPending || anyPending}
              onPress={() => checkAddress.mutate()}
            >
              Check Address
            </Button>
            {checkAddress.isPending ? (
              <Text className="text-sm leading-5 text-muted-foreground">Validating address…</Text>
            ) : addressValidated ? (
              <Notice tone="emerald">Address validated. The carrier recognises it.</Notice>
            ) : addressCheck ? (
              <Notice tone="rose">{addressCheck.reason || "The carrier does not recognise this address. Correct it before forwarding."}</Notice>
            ) : (
              <Text className="text-xs leading-4 text-muted-foreground">Fill in the address above, then check it with the carrier.</Text>
            )}
            {suggestedAddress ? (
              <View className="gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3">
                <Text className="text-sm font-semibold text-sky-900">The carrier suggests</Text>
                <Text className="text-sm leading-5 text-sky-900">
                  {[
                    suggestedAddress.addressLine1,
                    suggestedAddress.addressLine2,
                    [suggestedAddress.city, [suggestedAddress.state, suggestedAddress.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "),
                  ]
                    .filter(Boolean)
                    .join("\n")}
                </Text>
                <Button variant="outline" size="sm" disabled={anyPending} onPress={useSuggestedAddress}>
                  Use suggested address
                </Button>
              </View>
            ) : null}
          </View>

          <View className="gap-3">
            {/* Las dos empiezan apagadas y solo las cambia el cliente: las
                tarifas de abajo son las de lo que tenga elegido. */}
            <ToggleRow
              label="Add tracking"
              description="Show only shipping services that include tracking."
              value={forwardForm.trackingRequested}
              disabled={selectRate.isPending}
              onValueChange={(value) => onQuoteField("trackingRequested", value)}
            />
            {insuranceAllowed ? (
              <>
                <ToggleRow
                  label="Add insurance"
                  description={
                    "Adds insurance for the declared value ($" +
                    INSURED_VALUE_MIN_USD +
                    "–$" +
                    INSURED_VALUE_MAX_USD.toLocaleString("en-US") +
                    "). Only available with tracked services."
                  }
                  value={forwardForm.insuranceRequested}
                  disabled={selectRate.isPending}
                  onValueChange={(value) => onQuoteField("insuranceRequested", value)}
                />
                {forwardForm.insuranceRequested ? (
                  <Field
                    label={
                      "Declared value (USD, $" + INSURED_VALUE_MIN_USD + "–$" + INSURED_VALUE_MAX_USD.toLocaleString("en-US") + ")"
                    }
                  >
                    <Input
                      value={forwardForm.insuredValue}
                      onChangeText={(value) => onQuoteField("insuredValue", value)}
                      keyboardType="decimal-pad"
                      placeholder="100.00"
                    />
                  </Field>
                ) : null}
              </>
            ) : (
              // Paquetes y sobres grandes: el seguro adicional no se contrata. Se ve, pero no
              // se puede pedir, y no se dice que el valor declarado asegure nada.
              <ToggleRow
                label="Add insurance"
                description={insuranceUnavailableMessage(item?.type)}
                value={false}
                disabled
                onValueChange={() => {}}
              />
            )}
          </View>

          <View className="gap-3 rounded-lg border border-border bg-background p-3">
            <View className="flex-row items-center justify-between gap-3">
              <View className="min-w-0 flex-1">
                <Text className="text-sm font-medium text-foreground">Shipping rates</Text>
                <Text className="text-xs text-muted-foreground">Each price is Shipping &amp; Handling for the address and options above. The total, with the Mail Forwarding Fee, is shown below. Changing any option clears the rates.</Text>
                {ratesEnvironment === "sandbox" ? (
                  <Text className="mt-1 text-xs font-medium text-amber-900">
                    Test mode: these are sandbox rates. Any label created is a test label and will not ship.
                  </Text>
                ) : null}
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
                        {/* Solo lo que la tarifa trae: trackingIncluded y el
                            servicio Ins con su valor (lib/forwarding-options). */}
                        {rateExtras(rate, formatMoneyFromCents).length ? (
                          <Text className="mt-1 text-xs text-muted-foreground">
                            {rateExtras(rate, formatMoneyFromCents).join(" · ")}
                          </Text>
                        ) : null}
                      </View>
                      <Text className="font-semibold text-foreground">
                        {formatMoneyFromCents(rate.totalAmount?.amount)}
                      </Text>
                    </Pressable>
                  );
                })}

                {/* El total de la tarifa elegida, siempre (no solo con recargo):
                    Shipping & Handling (la tarifa, que ya trae la gestion
                    dentro), Mail Forwarding Fee y Total. Ver un precio y pagar
                    otro es lo que no puede pasar (lib/price-display). */}
                {selectedRate ? (
                  <View className="gap-1 rounded-lg border border-border bg-card p-3" accessibilityLabel="Price summary">
                    {chargeRows(chargeFromRate(selectedRate, immediateFeeCents)).map((row) => (
                      <View
                        key={row.label}
                        className={
                          row.strong
                            ? "mt-1 flex-row items-center justify-between gap-3 border-t border-border pt-2"
                            : "flex-row items-center justify-between gap-3"
                        }
                      >
                        <Text className={row.strong ? "text-sm font-medium text-foreground" : "text-sm text-muted-foreground"}>
                          {row.label}
                        </Text>
                        <Text className={row.strong ? "text-base font-semibold text-foreground" : "text-sm text-foreground"}>
                          {row.cents != null ? formatMoneyFromCents(row.cents) : "Pending"}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                <Button loading={selectRate.isPending} disabled={!selectedRateId} onPress={continueWithRate}>
                  Continue with selected rate
                </Button>
              </View>
            ) : quoteEmpty ? (
              // Ninguna tarifa con estas opciones: lo explica el backend y, si
              // es porque todas llevan seguimiento, se ofrece encenderlo. Solo
              // cambia la casilla; el cliente vuelve a pedir las tarifas.
              <View className="gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3" accessibilityRole="alert">
                <Text className="text-sm font-medium text-amber-900">No rates for these options</Text>
                <Text className="text-xs leading-4 text-amber-900">{quoteEmpty.message}</Text>
                {quoteEmpty.canEnableTracking && !forwardForm.trackingRequested ? (
                  <Button variant="outline" size="sm" disabled={anyPending} onPress={enableTracking}>
                    Turn on Add Tracking
                  </Button>
                ) : null}
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

        {/* Cartas y sobres grandes: el cliente no cotiza ni paga; pide el
            reenvio y el centro pesa, cotiza y confirma el precio. Si el backend
            todavia exige cotizacion para el sobre (FORWARDING_QUOTE_REQUIRED),
            se pasa a las tarifas con la direccion y Tracking ya puestos. */}
        {staffPrepared ? (
          <LetterForwardSheet
            key={letterForwardKey}
            visible={letterForwardOpen}
            onClose={() => setLetterForwardOpen(false)}
            mailItems={[item]}
            onCompleted={onRefresh}
            onQuoteRequired={(prefill) => {
              setLetterForwardOpen(false);
              clearRates();
              setForwardForm((current) => ({ ...current, ...prefill }));
              setForwardOpen(true);
            }}
          />
        ) : null}

        <Modal
          visible={pickupOpen}
          onClose={() => setPickupOpen(false)}
          title="Pick up your mail"
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
          <Notice tone="emerald">{PICKUP_DIALOG_DESCRIPTION}</Notice>
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
    // Recien pagado un reenvio, la etiqueta llega unos segundos despues (la
    // compra el worker). Mientras tanto se vuelve a pedir cada 5 s, y solo
    // entonces: en cualquier otro estado no se sondea.
    refetchInterval: (q) => (shouldPollForLabel(q.state.data?.item?.serviceRequests) ? 5000 : false),
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
  // Memorizado: un [] nuevo en cada render invalidaria todos los useMemo que
  // dependen de el.
  const serviceRequests = useMemo(
    () => (Array.isArray(item?.serviceRequests) ? item.serviceRequests : []),
    [item]
  );

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
  // Escaneo cotizado por el centro que espera que el cliente lo apruebe.
  const scanApprovalRequest = useMemo(() => findScanAwaitingApproval(serviceRequests), [serviceRequests]);
  // Escaneo con cobro sin confirmar (GET scan-payment decide si hay algo que decir).
  const scanPaymentRequest = useMemo(
    () => (Array.isArray(serviceRequests) ? serviceRequests.find(shouldTrackScanPayment) : null) || null,
    [serviceRequests]
  );

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
  const paidForwardAwaitingLabel = useMemo(() => findPaidForwardAwaitingLabel(serviceRequests), [serviceRequests]);
  const latestForward = useMemo(() => latestForwardRequest(serviceRequests), [serviceRequests]);
  const pickupGroup = useMemo(() => describePickupGroup(serviceRequests, item), [serviceRequests, item]);
  const readyToShipForwardRequest = useMemo(
    () => findRequest(serviceRequests, (r) => r?.type === "FORWARD" && r?.status === "READY_TO_SHIP"),
    [serviceRequests]
  );
  /**
   * Reenvio pendiente de pago por el cliente.
   *
   * Lo que decide es que haya una tarifa elegida con importe: un paquete que
   * el cliente cotizo, o cualquier envio que preparo el centro (el del mes,
   * cartas en un sobre incluidas) y que espera su pago. Una carta pedida sin
   * cotizar no tiene importe y no enseña tarjeta: es lo que evitaba antes el
   * filtro por paquete, que dejaba sin forma de pagar los envios del centro.
   */
  const payableForwardRequest = useMemo(
    () =>
      findRequest(serviceRequests, (r) => {
        if (r?.type !== "FORWARD") return false;

        const paymentStatus = r?.forwardDetails?.paymentStatus || "NOT_STARTED";
        const amount = Number(r?.forwardDetails?.quotedAmountCents || 0);

        return (
          ["OPEN", "PROCESSING"].includes(r?.status)
          && PAYABLE_PAYMENT_STATUSES.includes(paymentStatus)
          && amount > 0
        );
      }),
    [serviceRequests]
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
                <Text className="text-center font-brand-medium text-[14px] text-ink/60">
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
            {mailbox ? <MailboxChip>{mailbox}</MailboxChip> : <Text className="font-brand-medium text-[14px] text-ink">-</Text>}
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

        {pickupGroup ? <PickupRequestCard group={pickupGroup} /> : null}

        {availableActions ? (
          <ActionsCard
            item={item}
            mailItemId={item.id}
            availableActions={availableActions}
            serviceNotices={serviceNotices}
            supportEmail={supportEmail}
            onRefresh={() => query.refetch()}
            onPickupReady={(data) => queryClient.setQueryData(["client-mail-item", id], (previous) => applyReadyPickup(previous, data))}
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
            <Text className="font-brand text-[14px] leading-6 text-ink">{lastAction.description}</Text>
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
              <Text className="mt-2 font-brand text-[14px] text-ink/60">{completedScanRequest.scanDetails.quoteNotes}</Text>
            ) : null}
          </NoticeCard>
        ) : null}

        {scanApprovalRequest ? (
          <NoticeCard tone="amber" title="Scan approval" description="Your center quoted this scan. Review it and approve to receive it.">
            <ScanApprovalCard request={scanApprovalRequest} onRefresh={() => query.refetch()} />
          </NoticeCard>
        ) : null}

        {scanPaymentRequest ? <ScanPaymentCard request={scanPaymentRequest} onRefresh={() => query.refetch()} /> : null}

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
            <SummaryLine label={SHIPPING_AND_HANDLING_LABEL} value={formatMoneyFromCents(approvableForwardRequest.forwardDetails.quotedAmountCents)} />
            <SummaryLine label="Quoted At" value={formatDate(approvableForwardRequest.forwardDetails.quotedAt)} />
          </NoticeCard>
        ) : null}

        {paidForwardAwaitingLabel && !readyToShipForwardRequest ? (
          <NoticeCard
            tone="emerald"
            title={describePaidForwardProgress(paidForwardAwaitingLabel).title}
            description={describePaidForwardProgress(paidForwardAwaitingLabel).description}
          >
            <SummaryLine label="Carrier" value={paidForwardAwaitingLabel.forwardDetails.quotedCarrier} />
            <SummaryLine label="Service" value={paidForwardAwaitingLabel.forwardDetails.quotedService} />
            <SummaryLine label="Paid" value={paidAmountLabel(paidForwardAwaitingLabel.forwardDetails)} />
            <SummaryLine label="Paid At" value={formatDate(paidForwardAwaitingLabel.forwardDetails.paidAt)} />
          </NoticeCard>
        ) : null}

        {!approvableForwardRequest && readyToShipForwardRequest?.forwardDetails ? (
          <NoticeCard tone="emerald" title="Forward Approved" description="Paid. The center can ship it.">
            <SummaryLine label="Carrier" value={readyToShipForwardRequest.forwardDetails.quotedCarrier} />
            <SummaryLine label="Service" value={readyToShipForwardRequest.forwardDetails.quotedService} />
            <SummaryLine label="Paid" value={paidAmountLabel(readyToShipForwardRequest.forwardDetails)} />
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
                      <Text className="font-brand-medium text-[14px] text-ink/60">{media.kind || "FILE"}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </DetailCard>
        ) : null}

        {latestForward ? <ForwardSummaryCard request={latestForward} /> : null}

        <DetailCard className="p-5">
          <CardHeading className="mb-4">History</CardHeading>
          {history.length === 0 ? (
            <Text className="font-brand text-[14px] text-ink/60">No events yet.</Text>
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
                            {SHIPPING_AND_HANDLING_LABEL}: {formatMoneyFromCents(event.sr.forwardDetails.quotedAmountCents)}
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
        key={pdfMedia?.id || "pdf-viewer"}
        media={pdfMedia}
        title={"Scan · " + itemTitle}
        fileName={(item.itemCode ? "Item-" + item.itemCode : "Item") + "-scan.pdf"}
        onClose={() => setPdfMedia(null)}
      />
    </>
  );
}
