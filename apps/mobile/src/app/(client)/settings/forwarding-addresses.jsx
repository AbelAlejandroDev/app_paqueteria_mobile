import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react-native";

import { api } from "@/lib/api";
import { brand } from "@/lib/brand";
import { formatErrorMessage } from "@/lib/utils";
import { US_STATES } from "@/lib/us-states";
import EmptyState from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const ENDPOINT = "/client/forwarding-addresses";
const QUERY_KEY = ["client-forwarding-addresses"];

const EMPTY_FORM = {
  label: "",
  name: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  zip: "",
  phone: "",
};

function toForm(address) {
  return {
    label: address.label || "",
    name: address.name || "",
    addressLine1: address.addressLine1 || "",
    addressLine2: address.addressLine2 || "",
    city: address.city || "",
    state: address.state || "",
    zip: address.zip || "",
    phone: address.phone || "",
  };
}

/** "+13055551234" se lee mejor como "+1 (305) 555 1234". */
function formatPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return value || "";

  return "+1 (" + national.slice(0, 3) + ") " + national.slice(3, 6) + " " + national.slice(6);
}

/** Accion en texto, sin icono, para no competir con el selector. */
function TextAction({ label, onPress, disabled, tone = "default" }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={8} className="py-1">
      <Text
        className={
          tone === "danger"
            ? "text-sm font-medium text-rose-700"
            : "text-sm font-medium text-foreground"
        }
        style={disabled ? { opacity: 0.5 } : null}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function AddressCard({ address, onEdit, onDelete, onMakeDefault, busy }) {
  const lines = [address.addressLine1, address.addressLine2, `${address.city}, ${address.state} ${address.zip}`]
    .filter(Boolean);

  return (
    <Card>
      <CardContent className="gap-3 p-4">
        {/* La etiqueta primero: es como el cliente reconoce la direccion. */}
        <Text className="text-base font-semibold text-foreground">
          {address.label || address.name}
        </Text>

        {address.phone ? (
          <Text className="text-sm font-medium text-foreground">{formatPhone(address.phone)}</Text>
        ) : null}

        <View>
          {address.label ? (
            <Text className="text-sm leading-5 text-muted-foreground">{address.name}</Text>
          ) : null}
          {lines.map((line) => (
            <Text key={line} className="text-sm leading-5 text-muted-foreground">
              {line}
            </Text>
          ))}
        </View>

        <View className="flex-row items-center justify-between gap-3 border-t border-border pt-3">
          {/* Marcar la principal es elegir entre varias, asi que se comporta
              como un radio: se enciende, no se apaga. */}
          <Pressable
            onPress={() => (address.isDefault ? null : onMakeDefault(address))}
            disabled={busy || address.isDefault}
            hitSlop={8}
            accessibilityRole="radio"
            accessibilityState={{ selected: address.isDefault }}
            className="min-w-0 flex-1 flex-row items-center gap-2"
          >
            <View
              className={
                address.isDefault
                  ? "h-5 w-5 items-center justify-center rounded-full border-2 border-primary"
                  : "h-5 w-5 rounded-full border-2 border-slate-300"
              }
            >
              {address.isDefault ? <View className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}
            </View>
            <Text
              className={
                address.isDefault
                  ? "text-sm font-medium text-foreground"
                  : "text-sm text-muted-foreground"
              }
            >
              Predeterminado
            </Text>
          </Pressable>

          <View className="flex-row items-center gap-4">
            <TextAction label="Editar" disabled={busy} onPress={() => onEdit(address)} />
            <TextAction label="Eliminar" tone="danger" disabled={busy} onPress={() => onDelete(address)} />
          </View>
        </View>
      </CardContent>
    </Card>
  );
}

export default function ForwardingAddressesScreen() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);

  // Se consulta al entrar aqui, no al abrir Settings.
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => (await api.get(ENDPOINT)).data?.items || [],
  });

  const onField = (field) => (value) => setForm((current) => ({ ...current, [field]: value }));

  const closeForm = () => {
    setOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  };

  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        label: form.label.trim() || null,
        name: form.name.trim(),
        addressLine1: form.addressLine1.trim(),
        addressLine2: form.addressLine2.trim() || null,
        city: form.city.trim(),
        state: form.state,
        zip: form.zip.trim(),
        phone: form.phone.trim() || null,
      };

      return editing
        ? (await api.patch(`${ENDPOINT}/${editing.id}`, payload)).data
        : (await api.post(ENDPOINT, payload)).data;
    },
    onSuccess: () => {
      closeForm();
      refresh();
    },
    onError: (error) => {
      Alert.alert("No se pudo guardar", formatErrorMessage(error, "Unable to save the address"));
    },
  });

  const makeDefault = useMutation({
    mutationFn: async (address) =>
      (await api.patch(`${ENDPOINT}/${address.id}`, { isDefault: true })).data,
    onSuccess: refresh,
    onError: (error) => {
      Alert.alert("No se pudo cambiar", formatErrorMessage(error));
    },
  });

  const remove = useMutation({
    mutationFn: async (address) => api.delete(`${ENDPOINT}/${address.id}`),
    onSuccess: refresh,
    onError: (error) => {
      Alert.alert("No se pudo borrar", formatErrorMessage(error));
    },
  });

  const busy = save.isPending || makeDefault.isPending || remove.isPending;

  const startCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  };

  const startEdit = (address) => {
    setEditing(address);
    setForm(toForm(address));
    setOpen(true);
  };

  const confirmDelete = (address) => {
    Alert.alert("Borrar dirección", "¿Seguro que quieres eliminarla?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Borrar", style: "destructive", onPress: () => remove.mutate(address) },
    ]);
  };

  const canSave =
    form.name.trim() && form.addressLine1.trim() && form.city.trim() && form.state && form.zip.trim();

  if (query.isLoading) {
    return (
      <View className="flex-1 gap-4 bg-background p-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </View>
    );
  }

  if (query.isError) {
    return (
      <View className="flex-1 gap-4 bg-background p-4">
        <EmptyState title="No se pudieron cargar las direcciones" description={formatErrorMessage(query.error)} />
        <Button variant="outline" onPress={() => query.refetch()}>
          Reintentar
        </Button>
      </View>
    );
  }

  const items = query.data || [];

  return (
    <>
      <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-4 pb-24">
        {items.length === 0 ? (
          <EmptyState
            title="Sin direcciones de reenvío"
            description="Añade una para poder reenviar tu correspondencia."
          />
        ) : (
          items.map((address) => (
            <AddressCard
              key={address.id}
              address={address}
              busy={busy}
              onEdit={startEdit}
              onDelete={confirmDelete}
              onMakeDefault={(item) => makeDefault.mutate(item)}
            />
          ))
        )}

        <Button icon={<Plus size={18} color={brand.primaryForeground} />} onPress={startCreate}>
          Añadir dirección
        </Button>

        <Text className="px-1 text-xs leading-4 text-muted-foreground">
          Tu centro recibe un aviso cuando cambias estos datos, por si tiene correspondencia
          preparada con la dirección anterior.
        </Text>
      </ScrollView>

      <Modal
        visible={open}
        onClose={closeForm}
        title={editing ? "Editar dirección" : "Nueva dirección"}
        description="La marcada como principal es la que se usa al reenviar."
        footer={
          <>
            <Button variant="outline" onPress={closeForm}>
              Cancelar
            </Button>
            <Button loading={save.isPending} disabled={!canSave} onPress={() => save.mutate()}>
              Guardar
            </Button>
          </>
        }
      >
        <Field label="Etiqueta (opcional)">
          <Input value={form.label} onChangeText={onField("label")} placeholder="Casa, Oficina..." />
        </Field>
        <Field label="Destinatario">
          <Input value={form.name} onChangeText={onField("name")} />
        </Field>
        <Field label="Dirección">
          <Input value={form.addressLine1} onChangeText={onField("addressLine1")} />
        </Field>
        <Field label="Línea 2 (opcional)">
          <Input value={form.addressLine2} onChangeText={onField("addressLine2")} />
        </Field>
        <Field label="Ciudad">
          <Input value={form.city} onChangeText={onField("city")} />
        </Field>
        <Field label="Estado">
          <Select
            value={form.state}
            onValueChange={onField("state")}
            options={US_STATES}
            placeholder="Selecciona estado"
            title="Estado"
          />
        </Field>
        <Field label="ZIP">
          <Input value={form.zip} onChangeText={onField("zip")} keyboardType="number-pad" />
        </Field>
        <Field label="Teléfono (opcional)">
          <Input value={form.phone} onChangeText={onField("phone")} keyboardType="phone-pad" />
        </Field>
      </Modal>
    </>
  );
}
