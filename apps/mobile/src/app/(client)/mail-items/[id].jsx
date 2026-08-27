import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Linking, Pressable, RefreshControl, ScrollView, Switch, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Eye, ImageIcon, Package2, ScanLine, Store, Trash2, Truck } from "lucide-react-native";

import { api } from "@/lib/api";
import { brand } from "@/lib/brand";
import { useAuth } from "@/context/AuthContext";
import { formatDate, formatErrorMessage } from "@/lib/utils";
import { formatStatusDisplay, getCurrentStatusColor, getCurrentStatusLabel } from "@/lib/mail-item-display";
import {
  buildTimeline,
  findRequest,
  formatItemWeight,
  formatMoneyFromCents,
  getScanMedia,
  getVisibleMedia,
  hasDisplayValue,
  itemStatusColor,
  PAYABLE_PAYMENT_STATUSES,
  requestStatusColor,
} from "@/lib/mail-item-detail";
import { formatServiceNoticeMessage, normalizeBasicPlanServiceNotices } from "@/lib/service-notices";
import { US_STATES } from "@/lib/us-states";
import EmptyState from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

function DetailRow({ label, value, last = false }) {
  return (
    <View className={last ? "flex-row items-center justify-between gap-4 py-3" : "flex-row items-center justify-between gap-4 border-b border-border py-3"}>
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="max-w-[65%] text-right text-sm font-medium text-foreground">{value}</Text>
    </View>
  );
}

function SummaryLine({ label, value }) {
  if (!hasDisplayValue(value)) return null;

  return (
    <Text className="text-sm text-foreground">
      <Text className="font-medium">{label}: </Text>
      {value}
    </Text>
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

function ActionsCard({ item, mailItemId, availableActions, serviceNotices, supportEmail, onRefresh }) {
  const [forwardOpen, setForwardOpen] = useState(false);
  const [pickupOpen, setPickupOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [noticeService, setNoticeService] = useState(null);

  const [forwardForm, setForwardForm] = useState(EMPTY_FORWARD);
  const [pickupWindow, setPickupWindow] = useState("");
  const [forwardQuoteId, setForwardQuoteId] = useState("");
  const [forwardRates, setForwardRates] = useState([]);
  const [selectedRateId, setSelectedRateId] = useState("");

  const { user } = useAuth();
  const isLetter = item?.type === "LETTER";

  const clearRates = () => {
    // Se llama en cada pulsación, así que conviene no re-renderizar de balde.
    if (!forwardQuoteId && forwardRates.length === 0 && !selectedRateId) return;

    setForwardQuoteId("");
    setForwardRates([]);
    setSelectedRateId("");
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
    onSuccess: () => {
      Alert.alert("Solicitud creada", "Tu solicitud se envió al centro.");
      setForwardOpen(false);
      setPickupOpen(false);
      setDiscardOpen(false);
      onRefresh?.();
    },
    onError: (error) => {
      Alert.alert("No se pudo crear", formatErrorMessage(error, "Failed to create request"));
      onRefresh?.();
    },
  });

  const rejectAssignment = useMutation({
    mutationFn: async () => {
      const response = await api.post("/client/mail-items/" + mailItemId + "/reject-assignment", {});
      return response.data;
    },
    onSuccess: () => {
      Alert.alert("Enviado", "El centro revisará la asignación.");
      setRejectOpen(false);
      onRefresh?.();
    },
    onError: (error) => {
      Alert.alert("No se pudo enviar", formatErrorMessage(error, "Failed to send assignment review"));
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
    },
    onError: (error) => {
      setForwardQuoteId("");
      setForwardRates([]);
      setSelectedRateId("");
      Alert.alert("Sin tarifas", formatErrorMessage(error, "Failed to load shipping rates"));
    },
  });

  /**
   * Reenvío de una carta.
   *
   * A diferencia de un paquete, el cliente no cotiza ni elige transportista:
   * solo manda la petición con su dirección y si quiere seguimiento o seguro.
   * El centro la tarifica después, y entonces el cliente aprueba el importe
   * por el flujo de AWAITING_CLIENT_APPROVAL que ya existe.
   */
  const requestLetterForward = useMutation({
    mutationFn: async () => {
      const response = await api.post("/client/service-requests", {
        mailItemId,
        type: "FORWARD",
        destinationName: forwardForm.recipient,
        address1: forwardForm.address1,
        address2: forwardForm.address2 || undefined,
        city: forwardForm.city,
        state: forwardForm.state,
        zip: forwardForm.zip,
        country: "US",
        phone: forwardForm.phone || undefined,
        shippingOptions: {
          trackingRequested: Boolean(forwardForm.trackingRequested),
          insuranceRequested: Boolean(forwardForm.insuranceRequested),
          insuredValueCents: forwardForm.insuranceRequested ? toInsuredValueCents(forwardForm) : 0,
        },
      });
      return response.data;
    },
    onSuccess: () => {
      Alert.alert("Solicitud enviada", "El centro preparará tu envío y te avisará del importe.");
      setForwardOpen(false);
      setForwardForm(EMPTY_FORWARD);
      onRefresh?.();
    },
    onError: (error) => {
      Alert.alert("No se pudo enviar", formatErrorMessage(error, "Failed to request forwarding"));
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
    onSuccess: () => {
      Alert.alert("Tarifa seleccionada", "Se creó la solicitud de reenvío.");
      setForwardOpen(false);
      onRefresh?.();
    },
    onError: (error) => {
      Alert.alert("No se pudo seleccionar", formatErrorMessage(error, "Unable to select forwarding rate"));
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
      Alert.alert("Faltan datos", "Rellena los campos obligatorios de reenvío.");
      return false;
    }

    if (forwardForm.insuranceRequested) {
      const value = Number(forwardForm.insuredValue || 0);

      if (!Number.isFinite(value) || value <= 0) {
        Alert.alert("Falta el valor asegurado", "Indica cuánto quieres asegurar.");
        return false;
      }

      if (value > MAX_INSURED_VALUE_USD) {
        Alert.alert("Valor demasiado alto", "El seguro admite hasta $" + MAX_INSURED_VALUE_USD + ".");
        return false;
      }
    }

    return true;
  };

  const getRates = () => {
    if (!forwardFormIsValid()) return;
    quoteRates.mutate();
  };

  const submitLetterForward = () => {
    if (!forwardFormIsValid()) return;
    requestLetterForward.mutate();
  };

  const continueWithRate = () => {
    if (!forwardQuoteId || !selectedRateId) {
      Alert.alert("Elige una tarifa", "Selecciona primero una tarifa de envío.");
      return;
    }
    selectRate.mutate();
  };

  // Los paquetes se reenvían o se recogen, pero su contenido no se escanea.
  const canScan = item?.type !== "PACKAGE" && availableActions?.canRequestScan;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Available actions</CardTitle>
        <CardDescription>Solicita operaciones sobre este item</CardDescription>
      </CardHeader>

      <CardContent className="gap-3 p-5 pt-0">
        {availableActions?.billingRestricted ? (
          <Notice tone="amber">
            {availableActions.reason || "Billing needs attention before requesting services."}
          </Notice>
        ) : null}

        {active.scan ? (
          <View className="flex-row items-start gap-4 rounded-lg border-2 border-sky-300 bg-sky-50 p-4">
            <View className="h-11 w-11 items-center justify-center rounded-full bg-sky-600">
              <ScanLine size={20} color="#ffffff" />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="font-semibold text-sky-950">Scan request in progress</Text>
              <Text className="mt-1 text-sm leading-5 text-sky-800">
                Tu item se está procesando. El escaneo aparecerá aquí cuando esté listo.
              </Text>
            </View>
          </View>
        ) : (
          <View className="gap-3">
            {canScan ? (
              <Button icon={<ScanLine size={18} color="#0f172a" />} disabled={anyPending} onPress={() => setNoticeService("scan")}>
                Request Scan
              </Button>
            ) : null}

            {availableActions?.canRequestForward ? (
              <Button icon={<Truck size={18} color="#0f172a" />} disabled={anyPending} onPress={() => setForwardOpen(true)}>
                Forward Item
              </Button>
            ) : null}

            {availableActions?.canRequestPickup ? (
              <Button icon={<Store size={18} color="#0f172a" />} disabled={anyPending} onPress={() => setPickupOpen(true)}>
                Pickup
              </Button>
            ) : null}

            {availableActions?.canRequestDiscard ? (
              <Button variant="destructive" icon={<Trash2 size={18} color="#ffffff" />} disabled={anyPending} onPress={() => setDiscardOpen(true)}>
                Discard
              </Button>
            ) : null}

            {availableActions?.canRejectAssignment ? (
              <Button
                variant="outline"
                className="border-amber-300 bg-amber-50"
                labelClassName="text-amber-900"
                icon={<AlertCircle size={18} color="#78350f" />}
                disabled={anyPending}
                onPress={() => setRejectOpen(true)}
              >
                Not mine
              </Button>
            ) : null}
          </View>
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
                Cancelar
              </Button>
            </>
          }
        >
          <Notice tone="amber">
            Tu solicitud será revisada y cualquier cargo aplicable se te mostrará antes de completar el servicio.
          </Notice>
        </Modal>

        <Modal
          visible={forwardOpen}
          onClose={() => setForwardOpen(false)}
          title="Request Forward"
          description={
            isLetter
              ? "Indica la dirección de destino. El centro tarificará el envío y te avisará."
              : "Indica la dirección de destino y elige una tarifa."
          }
          footer={
            <Button variant="outline" onPress={() => setForwardOpen(false)}>
              Cancelar
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
              title="Estado"
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
              description="Para First-Class se añade Certified Mail; Priority Mail usa Delivery Confirmation."
              value={forwardForm.trackingRequested}
              onValueChange={onQuoteField("trackingRequested")}
            />
            <ToggleRow
              label="Add insurance"
              description="Cubre el valor declarado si el envío se pierde o llega dañado. Incluye seguimiento."
              value={forwardForm.insuranceRequested}
              onValueChange={onQuoteField("insuranceRequested")}
            />
            {forwardForm.insuranceRequested ? (
              <Field label={"Insured value (USD, máx. $" + MAX_INSURED_VALUE_USD + ")"}>
                <Input
                  value={forwardForm.insuredValue}
                  onChangeText={onQuoteField("insuredValue")}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                />
              </Field>
            ) : null}
            <Text className="text-xs leading-4 text-muted-foreground">
              {isLetter
                ? "El centro incluirá estos extras al preparar tu envío."
                : "El coste de estos extras ya viene sumado en cada tarifa de abajo."}
            </Text>
          </View>

          {/* En cartas el cliente no cotiza ni elige transportista: manda la
              petición y el centro la tarifica después. */}
          {isLetter ? (
            <Button loading={requestLetterForward.isPending} onPress={submitLetterForward}>
              Send forwarding request
            </Button>
          ) : (
          <View className="gap-3 rounded-lg border border-border bg-background p-3">
            <View className="flex-row items-center justify-between gap-3">
              <View className="min-w-0 flex-1">
                <Text className="text-sm font-medium text-foreground">Shipping rates</Text>
                <Text className="text-xs text-muted-foreground">Tarifas de sandbox. Aún no se compran etiquetas.</Text>
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
                              rate.trackingIncluded ? "Tracking incluido" : null,
                              rate.insuranceRequested
                                ? "Asegurado " + formatMoneyFromCents(rate.insuredValueCents)
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

                <Button loading={selectRate.isPending} disabled={!selectedRateId} onPress={continueWithRate}>
                  Continue with selected rate
                </Button>
              </View>
            ) : (
              <Text className="text-xs text-muted-foreground">No rates loaded yet.</Text>
            )}
          </View>
          )}

          <Notice tone="sky">
            Para envíos fuera de Estados Unidos, contacta con tu centro
            {supportEmail ? " en " + supportEmail : ""}.
          </Notice>
        </Modal>

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
                Cancelar
              </Button>
            </>
          }
        >
          <Field label="Pickup window (optional)">
            <Input placeholder="p. ej. 9:00-11:00" value={pickupWindow} onChangeText={setPickupWindow} />
          </Field>
        </Modal>

        <Modal
          visible={discardOpen}
          onClose={() => setDiscardOpen(false)}
          title="¿Descartar este item?"
          description="Se envía una solicitud al centro confirmando que puede destruirse de forma segura."
          footer={
            <>
              <Button variant="destructive" loading={createRequest.isPending} onPress={submitDiscard}>
                Confirm Discard
              </Button>
              <Button variant="outline" onPress={() => setDiscardOpen(false)}>
                Cancelar
              </Button>
            </>
          }
        >
          <Notice tone="rose">
            El item no se elimina de inmediato. El personal debe revisar y completar la solicitud.
          </Notice>
        </Modal>

        <Modal
          visible={rejectOpen}
          onClose={() => setRejectOpen(false)}
          title="¿Este item no es tuyo?"
          description="El personal revisará la foto y la asignación. El item queda auditable mientras deciden reasignarlo o descartarlo."
          footer={
            <>
              <Button loading={rejectAssignment.isPending} onPress={() => rejectAssignment.mutate()}>
                Send to Staff
              </Button>
              <Button variant="outline" onPress={() => setRejectOpen(false)}>
                Cancelar
              </Button>
            </>
          }
        >
          <Notice tone="amber">
            Usa esto solo si el item pertenece a otro inquilino o se asignó a tu buzón por error.
          </Notice>
        </Modal>
      </CardContent>
    </Card>
  );
}

export default function MailItemDetailScreen() {
  const { id } = useLocalSearchParams();
  const queryClient = useQueryClient();
  const markedRef = useRef(null);

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
  const readyToShipForwardRequest = useMemo(
    () => findRequest(serviceRequests, (r) => r?.type === "FORWARD" && r?.status === "READY_TO_SHIP"),
    [serviceRequests]
  );
  const payableForwardRequest = useMemo(
    () =>
      findRequest(serviceRequests, (r) => {
        const paymentStatus = r?.forwardDetails?.paymentStatus || "NOT_STARTED";
        return r?.type === "FORWARD" && ["OPEN", "PROCESSING"].includes(r?.status) && PAYABLE_PAYMENT_STATUSES.includes(paymentStatus);
      }),
    [serviceRequests]
  );

  const lastAction = timeline.length > 0 ? timeline[timeline.length - 1] : null;

  // Al abrir el item, marca como leídas sus notificaciones pendientes.
  useEffect(() => {
    if (!item?.id || markedRef.current === item.id) return;
    markedRef.current = item.id;

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

  const statusColor = itemStatusColor(item.status);
  const currentColor = getCurrentStatusColor(item);
  const photoUrl = primaryPhoto?.signedUrl || primaryPhoto?.url;
  const serviceNotices = normalizeBasicPlanServiceNotices(serviceNoticesQuery.data?.basicPlanServiceNotices);
  const supportEmail = serviceNoticesQuery.data?.supportEmail || "";

  return (
    <>
      <Stack.Screen options={{ title: "Item " + (item.itemCode || item.id) }} />

      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="gap-6 p-4 pb-24"
        refreshControl={<RefreshControl refreshing={query.isFetching && !query.isLoading} onRefresh={query.refetch} />}
      >
        {item.storageFeeNotice ? (
          <Notice tone={item.storageFeeNotice.severity === "danger" ? "rose" : "amber"}>
            {item.storageFeeNotice.title + "\n" + item.storageFeeNotice.message}
          </Notice>
        ) : null}

        <Card>
          <View className="relative bg-slate-100">
            {photoUrl ? (
              <Pressable onPress={() => WebBrowser.openBrowserAsync(photoUrl)}>
                <Image source={{ uri: photoUrl }} style={{ width: "100%", height: 262 }} contentFit="cover" />
              </Pressable>
            ) : (
              <View className="h-[220px] w-full items-center justify-center gap-3">
                <ImageIcon size={48} color="#94a3b8" />
                <Text className="text-sm font-medium text-muted-foreground">
                  {hiddenScanCount > 0 ? "Scan files will appear here after completion." : "No package photo available"}
                </Text>
              </View>
            )}

            <View className="absolute right-3 top-3 items-end gap-1.5">
              <Badge variant="outline" className={statusColor.container} labelClassName={statusColor.label}>
                {formatStatusDisplay(item.status || "UNKNOWN")}
              </Badge>
              <Badge variant="outline" className={currentColor.container} labelClassName={currentColor.label}>
                {getCurrentStatusLabel(item)}
              </Badge>
            </View>
          </View>

          <CardContent className="p-5 pt-5">
            <Text className="mb-1 text-lg font-semibold text-foreground">Item Details</Text>
            <DetailRow label="Mailbox" value={mailbox || "-"} />
            <DetailRow label="Type" value={formatStatusDisplay(item.type)} />
            <DetailRow label="Weight" value={formatItemWeight(item)} />
            {/* Sin remitente no se pinta la fila: "Not provided" ocupa sitio
                sin decir nada, igual que carrier y tracking. */}
            {hasDisplayValue(item.senderName) ? <DetailRow label="Sender" value={item.senderName} /> : null}
            {hasDisplayValue(item.carrier) ? <DetailRow label="Carrier" value={item.carrier} /> : null}
            {hasDisplayValue(item.trackingNumber) ? <DetailRow label="Tracking" value={item.trackingNumber} /> : null}
            <DetailRow label="Last action" value={lastAction?.title || formatStatusDisplay(item.status || "Received")} />
            <DetailRow label="Assigned" value={formatDate(item.receivedAt || item.createdAt)} last />
          </CardContent>
        </Card>

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

        {completedScanRequest?.scanDetails ? (
          <Card className="border-emerald-200 bg-emerald-50">
            <CardHeader>
              <CardTitle className="text-base">Scan Completed</CardTitle>
              <CardDescription>Tu escaneo está listo para consultar.</CardDescription>
            </CardHeader>
            <CardContent className="gap-1.5 p-5 pt-0">
              <SummaryLine label="Pages" value={completedScanRequest.scanDetails.pageCount || 0} />
              <SummaryLine label="Included" value={completedScanRequest.scanDetails.includedPages || 0} />
              <SummaryLine label="Extra" value={completedScanRequest.scanDetails.extraPages || 0} />
              <SummaryLine label="Paid" value={formatMoneyFromCents(completedScanRequest.scanDetails.quotedAmountCents)} />
              <SummaryLine label="Paid At" value={formatDate(completedScanRequest.scanDetails.paidAt)} />
              {completedScanRequest.scanDetails.quoteNotes ? (
                <Text className="mt-2 text-sm text-muted-foreground">{completedScanRequest.scanDetails.quoteNotes}</Text>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {payableForwardRequest?.forwardDetails ? (
          <Card className="border-amber-200 bg-amber-50">
            <CardHeader>
              <CardTitle className="text-base">Forward Payment</CardTitle>
              <CardDescription>Tarifa de reenvío seleccionada, pendiente de pago.</CardDescription>
            </CardHeader>
            <CardContent className="gap-1.5 p-5 pt-0">
              <SummaryLine label="Carrier" value={payableForwardRequest.forwardDetails.quotedCarrier} />
              <SummaryLine label="Service" value={payableForwardRequest.forwardDetails.quotedService} />
              <SummaryLine label="Accepted quote" value={formatMoneyFromCents(payableForwardRequest.forwardDetails.quotedAmountCents)} />
              <SummaryLine label="Payment" value={formatStatusDisplay(payableForwardRequest.forwardDetails.paymentStatus)} />
              <Notice tone="amber" className="mt-2">
                El pago con tarjeta todavía no está disponible en la app. Complétalo desde el portal web.
              </Notice>
            </CardContent>
          </Card>
        ) : null}

        {!payableForwardRequest && approvableForwardRequest?.forwardDetails ? (
          <Card className="border-amber-200 bg-amber-50">
            <CardHeader>
              <CardTitle className="text-base">Forward Quote Ready</CardTitle>
            </CardHeader>
            <CardContent className="gap-1.5 p-5 pt-0">
              <SummaryLine label="Carrier" value={approvableForwardRequest.forwardDetails.quotedCarrier} />
              <SummaryLine label="Service" value={approvableForwardRequest.forwardDetails.quotedService} />
              <SummaryLine label="Quote" value={formatMoneyFromCents(approvableForwardRequest.forwardDetails.quotedAmountCents)} />
              <SummaryLine label="Quoted At" value={formatDate(approvableForwardRequest.forwardDetails.quotedAt)} />
            </CardContent>
          </Card>
        ) : null}

        {!approvableForwardRequest && readyToShipForwardRequest?.forwardDetails ? (
          <Card className="border-emerald-200 bg-emerald-50">
            <CardHeader>
              <CardTitle className="text-base">Forward Approved</CardTitle>
              <CardDescription>Pagado. El centro puede enviarlo.</CardDescription>
            </CardHeader>
            <CardContent className="gap-1.5 p-5 pt-0">
              <SummaryLine label="Carrier" value={readyToShipForwardRequest.forwardDetails.quotedCarrier} />
              <SummaryLine label="Service" value={readyToShipForwardRequest.forwardDetails.quotedService} />
              <SummaryLine label="Paid" value={formatMoneyFromCents(readyToShipForwardRequest.forwardDetails.quotedAmountCents)} />
              <SummaryLine label="Paid At" value={formatDate(readyToShipForwardRequest.forwardDetails.paidAt)} />
            </CardContent>
          </Card>
        ) : null}

        {galleryMedia.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Additional media</CardTitle>
            </CardHeader>
            <CardContent className="gap-3 p-5 pt-0">
              {galleryMedia.map((media, index) => {
                const url = media.signedUrl || media.url || "";
                const isImage = (media.mimeType || "").startsWith("image/");

                return (
                  <Pressable
                    key={media.id || index}
                    disabled={!url}
                    onPress={() => (url.toLowerCase().endsWith(".pdf") ? Linking.openURL(url) : WebBrowser.openBrowserAsync(url))}
                    className="overflow-hidden rounded-lg border border-border"
                  >
                    {isImage && url ? (
                      <Image source={{ uri: url }} style={{ width: "100%", height: 160 }} contentFit="cover" />
                    ) : (
                      <View className="h-40 items-center justify-center bg-muted">
                        <Text className="text-sm text-muted-foreground">{media.kind || "FILE"}</Text>
                      </View>
                    )}
                    <View className="p-3">
                      <Text className="text-xs text-muted-foreground">
                        {media.kind} • {media.mimeType}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
            <CardDescription>Qué ha pasado con este item</CardDescription>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            {timeline.length === 0 ? (
              <Text className="text-sm text-muted-foreground">No events yet.</Text>
            ) : (
              <View className="gap-5 border-l border-border pl-4">
                {timeline.map((event, index) => {
                  const requestColor = event.sr?.status ? requestStatusColor(event.sr.status) : null;

                  return (
                    <View key={index} className="gap-1">
                      <View
                        className={
                          index === 0
                            ? "absolute -left-[21px] mt-1.5 h-3 w-3 rounded-full bg-primary"
                            : "absolute -left-[21px] mt-1.5 h-3 w-3 rounded-full bg-slate-300"
                        }
                      />
                      <View className="flex-row flex-wrap items-center gap-2">
                        <Text className="text-sm font-medium text-foreground">{event.title}</Text>
                        {requestColor ? (
                          <Badge variant="outline" className={requestColor.container} labelClassName={requestColor.label}>
                            {formatStatusDisplay(event.sr.status)}
                          </Badge>
                        ) : null}
                      </View>
                      <Text className="text-xs text-muted-foreground">{formatDate(event.at)}</Text>
                      {event.description ? (
                        <Text className="text-sm text-muted-foreground">{event.description}</Text>
                      ) : null}

                      {event.sr?.type === "PICKUP" && hasDisplayValue(event.sr.pickupDetails?.pickupWindow) ? (
                        <View className="mt-1 rounded-md border border-border bg-background p-2">
                          <Text className="text-xs text-muted-foreground">
                            Pickup Window: {event.sr.pickupDetails.pickupWindow}
                          </Text>
                        </View>
                      ) : null}

                      {event.sr?.type === "FORWARD" && event.sr.forwardDetails ? (
                        <View className="mt-1 gap-0.5 rounded-md border border-border bg-background p-2">
                          {hasDisplayValue(event.sr.forwardDetails.destinationName) ? (
                            <Text className="text-xs text-muted-foreground">Recipient: {event.sr.forwardDetails.destinationName}</Text>
                          ) : null}
                          {hasDisplayValue(event.sr.forwardDetails.quotedCarrier) ? (
                            <Text className="text-xs text-muted-foreground">Carrier: {event.sr.forwardDetails.quotedCarrier}</Text>
                          ) : null}
                          {event.sr.forwardDetails.quotedAmountCents != null ? (
                            <Text className="text-xs text-muted-foreground">
                              Quote: {formatMoneyFromCents(event.sr.forwardDetails.quotedAmountCents)}
                            </Text>
                          ) : null}
                          {hasDisplayValue(event.sr.forwardDetails.trackingNumber) ? (
                            <Text className="text-xs text-muted-foreground">Tracking: {event.sr.forwardDetails.trackingNumber}</Text>
                          ) : null}
                        </View>
                      ) : null}

                      {event.sr?.type === "SCAN" && event.sr.scanDetails?.pageCount > 0 ? (
                        <View className="mt-1 gap-0.5 rounded-md border border-border bg-background p-2">
                          <Text className="text-xs text-muted-foreground">Pages: {event.sr.scanDetails.pageCount}</Text>
                          {event.sr.scanDetails.quotedAmountCents != null ? (
                            <Text className="text-xs text-muted-foreground">
                              Quote: {formatMoneyFromCents(event.sr.scanDetails.quotedAmountCents)}
                            </Text>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            )}
          </CardContent>
        </Card>
      </ScrollView>
    </>
  );
}
