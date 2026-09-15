import { useState } from "react";
import { Alert, Pressable, Text, useWindowDimensions, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Mail, Plus, ShieldCheck, Truck } from "lucide-react-native";

import { api } from "@/lib/api";
import { formatErrorMessage } from "@/lib/utils";
import { formatMoneyFromCents } from "@/lib/mail-item-detail";
import { US_STATES } from "@/lib/us-states";
import {
  addressErrorMessage,
  describeAddressVerification,
  forwardDestinationFields,
  isAddressUsableForForwarding,
  isVerifiedCheck,
  sameAddress,
  serverVerifiesAddresses,
  verifyPayload,
} from "@/lib/address-verification";
import AddressVerificationBadge from "@/components/common/address-verification-badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Modal, Notice } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Pedir el reenvio de una o varias cartas, igual que en el portal web
 * (ClientLetterForwardDialog).
 *
 * El cliente no tiene el sobre, asi que no puede saber lo que pesa: no cotiza
 * ni elige transportista. Pide el reenvio y el centro, que lo tiene en la mano,
 * lo pesa y confirma el franqueo.
 *
 * Dos pasos porque son dos decisiones distintas: primero si sigue adelante
 * sabiendo el recargo --lo unico que se conoce de antemano y lo que sorprende si
 * no se dice--, y despues a donde va.
 *
 * El estado vive aqui y se reinicia al abrir porque quien lo usa lo monta con una
 * `key` nueva cada vez: sin efectos que reseteen y sin arrastrar lo de la vez
 * anterior.
 */

// Los mismos limites que el portal web.
const MIN_INSURED_VALUE = 100;
const MAX_INSURED_VALUE = 5000;

const EMPTY_ADDRESS = {
  label: "",
  recipient: "",
  company: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  zip: "",
  phone: "",
};

// El telefono es obligatorio: va impreso en la etiqueta y el transportista lo exige.
const REQUIRED_FIELDS = ["recipient", "addressLine1", "city", "state", "zip", "phone"];

/** La direccion escrita como se lee en un sobre, no repartida en campos. */
function addressLines(address) {
  if (!address) return [];
  return [
    address.recipient,
    address.company,
    address.addressLine1,
    address.addressLine2,
    [address.city, address.state, address.zip].filter(Boolean).join(", "),
    address.phone,
  ].filter((line) => String(line || "").trim());
}

/** Vacio -> undefined: el backend valida longitudes minimas en lo que llega. */
function optional(value) {
  const trimmed = String(value || "").trim();
  return trimmed || undefined;
}

function Radio({ checked }) {
  return (
    <View
      className={
        checked
          ? "mt-0.5 h-5 w-5 items-center justify-center rounded-full border-2 border-foreground"
          : "mt-0.5 h-5 w-5 items-center justify-center rounded-full border-2 border-slate-300"
      }
    >
      {checked ? <View className="h-2.5 w-2.5 rounded-full bg-foreground" /> : null}
    </View>
  );
}

function CheckBox({ checked }) {
  return (
    <View
      className={
        checked
          ? "h-5 w-5 items-center justify-center rounded border-2 border-foreground bg-foreground"
          : "h-5 w-5 items-center justify-center rounded border-2 border-slate-300 bg-card"
      }
    >
      {checked ? <Check size={14} color="#ffffff" strokeWidth={3} /> : null}
    </View>
  );
}

/** Tarjeta con casilla, como los <label> con checkbox del portal. */
function CheckCard({ checked, onToggle, icon: Icon, label, description, children }) {
  return (
    <View className="rounded-lg border border-border bg-card">
      <Pressable
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        className="flex-row items-center gap-3 p-4"
      >
        <CheckBox checked={checked} />
        <View className="min-w-0 flex-1">
          <View className="flex-row items-center gap-2">
            {Icon ? <Icon size={18} color="#0f172a" /> : null}
            <Text className="text-base font-semibold text-foreground">{label}</Text>
          </View>
          {description ? <Text className="mt-0.5 text-xs text-muted-foreground">{description}</Text> : null}
        </View>
      </Pressable>
      {children ? <View className="gap-1.5 px-4 pb-4">{children}</View> : null}
    </View>
  );
}

/**
 * Los dos botones del pie. Lado a lado como en el portal cuando caben; en un
 * telefono de 360 dp, y mas con la letra del sistema agrandada, "Request
 * forward" no cabe en media fila, asi que se apilan con la accion principal
 * arriba.
 */
function SheetActions({ children }) {
  const compact = useWindowDimensions().width < 400;
  const [secondary, primary] = children;

  if (compact) {
    return (
      <View className="gap-2">
        {primary}
        {secondary}
      </View>
    );
  }

  return <View className="flex-row gap-3">{children}</View>;
}

function RequiredLabel({ children }) {
  return (
    <>
      {children}
      <Text className="text-destructive"> *</Text>
    </>
  );
}

export default function LetterForwardSheet({ visible, onClose, mailItems, onCompleted }) {
  const queryClient = useQueryClient();
  const items = (mailItems || []).filter((item) => item?.type === "LETTER");

  const [step, setStep] = useState("fee");
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [addingAddress, setAddingAddress] = useState(false);
  const [draft, setDraft] = useState(EMPTY_ADDRESS);
  const [saveForLater, setSaveForLater] = useState(true);
  const [trackingRequested, setTrackingRequested] = useState(false);
  const [insuranceRequested, setInsuranceRequested] = useState(false);
  const [insuredValue, setInsuredValue] = useState("");
  const [addressCheck, setAddressCheck] = useState(null);

  const previewQuery = useQuery({
    queryKey: ["client-forward-immediate-preview"],
    queryFn: async () => (await api.get("/client/forwarding/immediate-preview")).data,
    enabled: visible,
  });

  const preview = previewQuery.data;
  const addresses = preview?.addresses || [];
  const feeCents = preview?.immediateForwardFeeCents ?? null;
  const postageHandlingCents = preview?.postageHandlingFeeCents ?? 0;

  // La predeterminada viene elegida: es la que usa casi todo el mundo. Se deriva
  // en vez de copiarla al estado, asi no hace falta un efecto que la sincronice.
  const effectiveAddressId = selectedAddressId || preview?.defaultAddressId || addresses[0]?.id || "";
  const selectedAddress = addresses.find((address) => address.id === effectiveAddressId) || null;

  const draftIsComplete = REQUIRED_FIELDS.every((field) => String(draft[field] || "").trim());

  // Sin direccion verificada no sale ningun reenvio: Pitney Bowes rechaza al
  // comprar la etiqueta la que no reconoce, con la solicitud ya creada.
  // El servidor vuelve a verificar al crear el reenvio; esto solo avisa antes.
  const draftVerified = isVerifiedCheck(addressCheck);
  const destinationVerified = addingAddress ? draftVerified : isAddressUsableForForwarding(selectedAddress);

  const setDraftField = (field) => (value) => {
    // Cambiar la direccion invalida lo que dijo el transportista de la anterior.
    setAddressCheck(null);
    setDraft((current) => ({ ...current, [field]: value }));
  };

  /**
   * Lo que dice el transportista de la direccion escrita. Se pregunta antes
   * porque el rechazo, si no, llega al comprar la etiqueta, con el envio ya
   * pedido.
   */
  const verifyAddress = useMutation({
    mutationFn: async () =>
      (
        await api.post("/client/forwarding-addresses/verify", verifyPayload(draft))
      ).data,
    onSuccess: (data) => setAddressCheck(data),
    onError: (error) => {
      setAddressCheck(null);
      Alert.alert("Could not check the address", addressErrorMessage(error, "The address could not be checked right now."));
    },
  });

  /**
   * Re-verificar una guardada (las anteriores a la verificacion quedaron sin
   * verificar). El resultado lo guarda el servidor: no hay que repetirlo en la
   * siguiente sesion.
   */
  const verifySaved = useMutation({
    mutationFn: async (address) => (await api.post("/client/addresses/" + address.id + "/verify")).data,
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ["client-forward-immediate-preview"] });
      const meta = describeAddressVerification(data?.address?.verification);
      if (meta.status !== "VERIFIED") {
        Alert.alert("Address not verified", meta.message ? meta.hint + " (" + meta.message + ")" : meta.hint);
      }
    },
    onError: (error) => {
      Alert.alert("Could not check the address", addressErrorMessage(error, "The address could not be checked right now."));
    },
  });

  /**
   * La version que propone el transportista. Si se usa, es la que el mismo
   * reconoce, asi que cuenta como verificada.
   */
  const useSuggestedAddress = () => {
    const suggested = addressCheck?.suggested;
    if (!suggested) return;

    setDraft((current) => ({
      ...current,
      recipient: suggested.recipient || current.recipient,
      company: suggested.company || current.company,
      addressLine1: suggested.addressLine1 || current.addressLine1,
      addressLine2: suggested.addressLine2 || "",
      city: suggested.city || current.city,
      state: suggested.state || current.state,
      zip: suggested.zip || current.zip,
    }));
    setAddressCheck({ ...addressCheck, suggested: null });
  };

  const requestForward = useMutation({
    mutationFn: async () => {
      let destination = selectedAddress;

      // Una direccion nueva se guarda antes de usarla, para que la proxima vez
      // este en la lista y no haya que volver a escribirla. El servidor la
      // verifica al guardarla y guarda la version normalizada.
      if (addingAddress) {
        if (saveForLater) {
          const saved = await api.post("/client/addresses", {
            label: optional(draft.label),
            recipient: draft.recipient.trim(),
            company: optional(draft.company),
            addressLine1: draft.addressLine1.trim(),
            addressLine2: optional(draft.addressLine2),
            city: draft.city.trim(),
            state: draft.state,
            zip: draft.zip.trim(),
            phone: optional(draft.phone),
          });
          destination = saved.data?.address;
        } else {
          destination = { ...draft };
        }
      }

      const insuredValueCents = insuranceRequested ? Math.round(Number(insuredValue || 0) * 100) : null;

      // Las cartas elegidas viajan juntas en un sobre: una sola peticion, un
      // solo envio y una sola etiqueta.
      const response = await api.post("/client/service-requests", {
        mailItemId: items[0].id,
        mailItemIds: items.map((item) => item.id),
        type: "FORWARD",
        // Una guardada viaja por su id: el servidor usa la que tiene verificada.
        ...forwardDestinationFields(destination),
        shippingOptions: {
          trackingRequested,
          insuranceRequested,
          ...(insuredValueCents ? { insuredValueCents } : {}),
        },
      });
      return response.data;
    },
    onSuccess: async () => {
      Alert.alert("Forward requested", "Your center will prepare it and confirm the cost.");
      onClose();
      queryClient.invalidateQueries({ queryKey: ["client-forward-immediate-preview"] });
      await onCompleted?.();
    },
    onError: (error) => {
      // Si la direccion se guardo pero la peticion fallo, la lista ya la trae.
      queryClient.invalidateQueries({ queryKey: ["client-forward-immediate-preview"] });
      Alert.alert(
        "Could not request forward",
        addressErrorMessage(error, formatErrorMessage(error, "The forward could not be requested."))
      );
    },
  });

  const pending = requestForward.isPending;
  const insuredNumber = Number(insuredValue);
  const insuranceIsValid =
    !insuranceRequested || (insuredNumber >= MIN_INSURED_VALUE && insuredNumber <= MAX_INSURED_VALUE);
  const canSubmit =
    (addingAddress ? draftIsComplete : Boolean(selectedAddress)) && destinationVerified && insuranceIsValid && !pending;

  const feeHeadline =
    feeCents === null
      ? "Forwarding now adds a handling fee."
      : feeCents > 0
        ? "Forwarding now adds " + formatMoneyFromCents(feeCents) + " to your postage."
        : "Forwarding now adds no handling fee.";

  if (step === "fee") {
    return (
      <Modal
        visible={visible}
        onClose={onClose}
        title="Forward this mail now?"
        footer={
          <SheetActions>
            <Button variant="outline" className="flex-1" onPress={onClose}>
              Not now
            </Button>
            <Button
              className="flex-1"
              loading={previewQuery.isLoading}
              disabled={previewQuery.isError}
              onPress={() => setStep("details")}
            >
              Continue
            </Button>
          </SheetActions>
        }
      >
        <View className="flex-row items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle size={18} color="#78350f" style={{ marginTop: 2 }} />
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-semibold leading-5 text-amber-900">{feeHeadline}</Text>
            <Text className="mt-1 text-sm leading-5 text-amber-900">
              Postage is charged on top and depends on the weight of your envelope, so your center confirms the
              total once the mail is packed.
              {postageHandlingCents > 0
                ? " Postage already includes a " + formatMoneyFromCents(postageHandlingCents) + " handling fee."
                : ""}
            </Text>
          </View>
        </View>

        <Text className="text-sm leading-5 text-muted-foreground">
          If you would rather wait, your mail stays in your mailbox at no extra cost.
        </Text>

        {previewQuery.isError ? (
          <View className="gap-2">
            <Notice tone="rose">{formatErrorMessage(previewQuery.error, "Unable to load forwarding details.")}</Notice>
            <Button variant="outline" size="sm" onPress={() => previewQuery.refetch()}>
              Retry
            </Button>
          </View>
        ) : null}
      </Modal>
    );
  }

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title="Where should we send it?"
      description={
        items.length === 1
          ? "Your center will pack and ship this letter."
          : "Your center will pack and ship these " + items.length + " letters."
      }
      footer={
        <SheetActions>
          <Button variant="outline" className="flex-1" disabled={pending} onPress={() => setStep("fee")}>
            Back
          </Button>
          <Button className="flex-1" loading={pending} disabled={!canSubmit} onPress={() => requestForward.mutate()}>
            Request forward
          </Button>
        </SheetActions>
      }
    >
      <View className="flex-row flex-wrap gap-2">
        {items.map((item) => (
          <View key={item.id} className="flex-row items-center gap-1.5 rounded-full bg-muted px-3 py-1">
            <Mail size={14} color="#334155" />
            <Text className="text-xs font-medium text-slate-700">{item.itemCode || item.id}</Text>
          </View>
        ))}
      </View>

      {/* Las guardadas se quedan siempre a la vista, con la predeterminada
          arriba. "Send to another address" es una opcion mas de la lista: al
          elegirla se abre el formulario debajo, y volver a una guardada es
          tocarla. Antes el formulario sustituia a la lista y, para volver a la
          Default, habia que cerrar la hoja. */}
      <View className="gap-3">
        {previewQuery.isLoading ? <Skeleton className="h-32 w-full" /> : null}

        {addresses.map((address) => {
          const checked = !addingAddress && effectiveAddressId === address.id;
          const verifies = serverVerifiesAddresses(address);
          const meta = describeAddressVerification(address.verification);
          const verifyingThis = verifySaved.isPending && verifySaved.variables?.id === address.id;

          return (
            <View
              key={address.id}
              className={
                checked
                  ? "gap-3 rounded-lg border border-foreground bg-card p-4"
                  : "gap-3 rounded-lg border border-border bg-card p-4"
              }
            >
              <Pressable
                onPress={() => {
                  setSelectedAddressId(address.id);
                  setAddingAddress(false);
                }}
                accessibilityRole="radio"
                accessibilityState={{ checked }}
                className="flex-row items-start gap-3"
              >
                <Radio checked={checked} />
                <View className="min-w-0 flex-1">
                  {/* Arriba: Default (o su nombre) a la izquierda y el estado de
                      verificacion en la esquina. */}
                  <View className="mb-1 flex-row flex-wrap items-center justify-between gap-2">
                    <Text className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {address.isDefault ? "Default" : address.label || "Saved address"}
                    </Text>
                    {verifies ? <AddressVerificationBadge verification={address.verification} /> : null}
                  </View>
                  {addressLines(address).map((line, index) => (
                    <Text key={index} className="text-sm leading-6 text-foreground">
                      {line}
                    </Text>
                  ))}
                </View>
              </Pressable>

              {/* Como en el portal: una sin verificar no se puede elegir como
                  destino, pero se puede verificar aqui mismo. */}
              {checked && verifies && meta.status !== "VERIFIED" ? (
                <View className="gap-2 border-t border-border pt-3">
                  <Text
                    className={
                      meta.status === "INVALID"
                        ? "text-sm font-semibold leading-5 text-rose-900"
                        : "text-sm leading-5 text-amber-900"
                    }
                  >
                    {meta.hint}
                    {meta.message ? " (" + meta.message + ")" : ""}
                  </Text>
                  <Text className="text-sm leading-5 text-muted-foreground">
                    Mail can only be forwarded to an address the carrier recognises.
                  </Text>
                  <Button variant="outline" loading={verifyingThis} onPress={() => verifySaved.mutate(address)}>
                    Verify this address
                  </Button>
                </View>
              ) : null}
            </View>
          );
        })}

        {addresses.length === 0 && !previewQuery.isLoading ? (
          <View className="rounded-lg border border-border bg-muted p-4">
            <Text className="text-sm leading-5 text-muted-foreground">
              You have no saved addresses yet. Add the one you want this mail sent to.
            </Text>
          </View>
        ) : null}

        <View
          className={
            addingAddress
              ? "gap-4 rounded-lg border border-foreground bg-card p-4"
              : "gap-4 rounded-lg border border-border bg-card p-4"
          }
        >
          <Pressable
            onPress={() => setAddingAddress(true)}
            accessibilityRole="radio"
            accessibilityState={{ checked: addingAddress }}
            className="flex-row items-center gap-3"
          >
            <Radio checked={addingAddress} />
            <Plus size={18} color="#0f172a" />
            <Text className="min-w-0 flex-1 text-base font-semibold text-foreground">Send to another address</Text>
          </Pressable>

          {addingAddress ? (
            <View className="gap-3">
              <Field label="Name this address">
                <Input value={draft.label} placeholder="Home, Office" onChangeText={setDraftField("label")} />
              </Field>
              <Field label={<RequiredLabel>Recipient</RequiredLabel>}>
                <Input value={draft.recipient} onChangeText={setDraftField("recipient")} autoComplete="name" />
              </Field>
              <Field label="Company">
                <Input value={draft.company} onChangeText={setDraftField("company")} />
              </Field>
              <Field label={<RequiredLabel>Address line 1</RequiredLabel>}>
                <Input value={draft.addressLine1} onChangeText={setDraftField("addressLine1")} autoComplete="street-address" />
              </Field>
              <Field label="Address line 2">
                <Input value={draft.addressLine2} onChangeText={setDraftField("addressLine2")} />
              </Field>
              <Field label={<RequiredLabel>City</RequiredLabel>}>
                <Input value={draft.city} onChangeText={setDraftField("city")} />
              </Field>
              <Field label={<RequiredLabel>State</RequiredLabel>}>
                <Select
                  value={draft.state}
                  onValueChange={setDraftField("state")}
                  options={US_STATES}
                  placeholder="Select state"
                  title="State"
                />
              </Field>
              <Field label={<RequiredLabel>ZIP</RequiredLabel>}>
                <Input value={draft.zip} onChangeText={setDraftField("zip")} keyboardType="number-pad" maxLength={10} />
              </Field>
              <Field label={<RequiredLabel>Phone</RequiredLabel>}>
                <Input value={draft.phone} onChangeText={setDraftField("phone")} keyboardType="phone-pad" autoComplete="tel" />
                <Text className="text-xs text-muted-foreground">The carrier prints it on the label.</Text>
              </Field>

              <View className="gap-3 rounded-lg border border-border bg-card p-4">
                <Text className="text-sm leading-5 text-muted-foreground">
                  Check the address with the carrier. It is required before requesting the forward.
                </Text>
                <Button
                  variant="outline"
                  loading={verifyAddress.isPending}
                  disabled={!draftIsComplete}
                  onPress={() => verifyAddress.mutate()}
                >
                  Check address
                </Button>

                {draftVerified ? (
                  <Notice tone="emerald">The carrier recognises this address.</Notice>
                ) : null}

                {/* Lo que propone el transportista, si difiere: suele corregir el ZIP
                    o la abreviatura. Usarla evita el rechazo al comprar la etiqueta. */}
                {draftVerified && addressCheck?.suggested && !sameAddress(addressCheck.suggested, draft) ? (
                  <View className="gap-2 rounded-lg border border-sky-200 bg-sky-50 p-4">
                    <Text className="text-sm font-semibold text-sky-900">The carrier suggests</Text>
                    {addressLines(addressCheck.suggested).map((line, index) => (
                      <Text key={index} className="text-sm leading-5 text-sky-900">
                        {line}
                      </Text>
                    ))}
                    <Button variant="outline" size="sm" onPress={useSuggestedAddress}>
                      Use suggested address
                    </Button>
                  </View>
                ) : null}

                {addressCheck && !draftVerified ? (
                  <View className="rounded-lg border border-rose-200 bg-rose-50 p-4">
                    <Text className="text-sm font-semibold leading-5 text-rose-900">
                      {addressCheck.reason || "The carrier does not recognise this address."}
                    </Text>
                    <Text className="mt-1 text-sm leading-5 text-rose-900">
                      Correct it before forwarding: the carrier will refuse to print a label for it and the forward
                      will not go out.
                    </Text>
                  </View>
                ) : null}
              </View>

              <CheckCard
                checked={saveForLater}
                onToggle={() => setSaveForLater((value) => !value)}
                label="Save this address"
                description="Keep it in your profile so you can pick it next time."
              />

            </View>
          ) : null}
        </View>
      </View>

      <CheckCard
        checked={trackingRequested}
        onToggle={() => setTrackingRequested((value) => !value)}
        icon={Truck}
        label="Add tracking"
      />

      <CheckCard
        checked={insuranceRequested}
        onToggle={() => setInsuranceRequested((value) => !value)}
        icon={ShieldCheck}
        label="Add insurance"
      >
        {insuranceRequested ? (
          <Field label={<RequiredLabel>Declared value (USD)</RequiredLabel>}>
            <Input
              value={insuredValue}
              onChangeText={setInsuredValue}
              keyboardType="decimal-pad"
              placeholder="100.00"
            />
            <Text className="text-xs text-muted-foreground">
              Between ${MIN_INSURED_VALUE} and ${MAX_INSURED_VALUE.toLocaleString("en-US")}.
            </Text>
          </Field>
        ) : null}
      </CheckCard>

      {feeCents > 0 ? (
        <View className="gap-1.5 rounded-lg border border-border bg-muted p-4">
          <View className="flex-row justify-between gap-4">
            <Text className="text-xs text-muted-foreground">Immediate forward fee</Text>
            <Text className="text-xs font-semibold text-foreground">{formatMoneyFromCents(feeCents)}</Text>
          </View>
          <View className="flex-row justify-between gap-4">
            <Text className="flex-1 text-xs text-muted-foreground">
              Postage
              {postageHandlingCents > 0 ? " (includes " + formatMoneyFromCents(postageHandlingCents) + " handling)" : ""}
            </Text>
            <Text className="text-xs font-semibold text-foreground">Confirmed by your center</Text>
          </View>
        </View>
      ) : null}
    </Modal>
  );
}
