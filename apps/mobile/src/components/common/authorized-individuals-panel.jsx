import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, UserCheck, X } from "lucide-react-native";

import { api } from "@/lib/api";
import { formatErrorMessage } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";

const EMPTY_FORM = {
  fullName: "",
  relationship: "",
  phone: "",
  email: "",
  notes: "",
};

const ENDPOINT = "/client/authorized-individuals";
const QUERY_KEY = ["client-authorized-individuals"];

export default function AuthorizedIndividualsPanel() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY_FORM);
  const [isAdding, setIsAdding] = useState(false);

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const response = await api.get(ENDPOINT);
      return response.data?.items || [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        fullName: form.fullName.trim(),
        relationship: form.relationship.trim() || undefined,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        notes: form.notes.trim() || undefined,
      };

      if (!payload.fullName) throw new Error("Full name is required.");

      const response = await api.post(ENDPOINT, payload);
      return response.data;
    },
    onSuccess: () => {
      setIsAdding(false);
      setForm(EMPTY_FORM);
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error) => {
      Alert.alert("No se pudo guardar", formatErrorMessage(error, "Unable to save authorized individual"));
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id) => {
      const response = await api.delete(ENDPOINT + "/" + id);
      return response.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: (error) => {
      Alert.alert("No se pudo eliminar", formatErrorMessage(error, "Unable to remove authorized individual"));
    },
  });

  const confirmRemove = (item) => {
    Alert.alert("Eliminar autorizado", "¿Quitar a " + item.fullName + " de la lista?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: () => removeMutation.mutate(item.id) },
    ]);
  };

  const onChange = (field) => (value) => setForm((current) => ({ ...current, [field]: value }));

  const items = query.data || [];
  const activeItems = items.filter((item) => item.isActive !== false);

  return (
    <View className="gap-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <View className="flex-row items-center gap-2">
            <UserCheck size={16} color="#64748b" />
            <Text className="text-base font-semibold text-foreground">Personas autorizadas</Text>
          </View>
          <Text className="mt-1 text-sm leading-5 text-muted-foreground">
            Quién puede recibir o recoger correo en tu nombre.
          </Text>
        </View>
        <Button
          variant="outline"
          size="sm"
          icon={isAdding ? <X size={16} color="#0f172a" /> : <Plus size={16} color="#0f172a" />}
          onPress={() => setIsAdding((value) => !value)}
        >
          {isAdding ? "Cancelar" : "Añadir"}
        </Button>
      </View>

      {isAdding ? (
        <View className="gap-3 rounded-lg border border-border bg-card p-4">
          <Field label="Nombre completo">
            <Input value={form.fullName} onChangeText={onChange("fullName")} />
          </Field>
          <Field label="Relación">
            <Input
              value={form.relationship}
              onChangeText={onChange("relationship")}
              placeholder="Familiar, asistente, pareja"
            />
          </Field>
          <Field label="Teléfono">
            <Input value={form.phone} onChangeText={onChange("phone")} keyboardType="phone-pad" />
          </Field>
          <Field label="Email">
            <Input
              value={form.email}
              onChangeText={onChange("email")}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </Field>
          <Field label="Notas">
            <Textarea
              value={form.notes}
              onChangeText={onChange("notes")}
              placeholder="Nota interna o instrucción de recogida"
            />
          </Field>
          <Button loading={createMutation.isPending} onPress={() => createMutation.mutate()}>
            Guardar
          </Button>
        </View>
      ) : null}

      {query.isLoading ? (
        <View className="rounded-lg border border-border bg-card p-4">
          <Text className="text-sm text-muted-foreground">Cargando personas autorizadas...</Text>
        </View>
      ) : query.isError ? (
        <View className="rounded-lg border border-rose-200 bg-rose-50 p-4">
          <Text className="text-sm text-rose-700">
            {formatErrorMessage(query.error, "Unable to load authorized individuals")}
          </Text>
        </View>
      ) : activeItems.length === 0 ? (
        <View className="rounded-lg border border-dashed border-slate-300 bg-card p-4">
          <Text className="text-sm text-muted-foreground">No hay ninguna persona autorizada.</Text>
        </View>
      ) : (
        <View className="gap-2">
          {activeItems.map((item) => (
            <View key={item.id} className="gap-3 rounded-lg border border-border bg-card p-4">
              <View className="flex-row flex-wrap items-center gap-2">
                <Text className="font-semibold text-foreground">{item.fullName}</Text>
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50" labelClassName="text-emerald-700">
                  Activo
                </Badge>
              </View>

              <View className="flex-row flex-wrap gap-x-4 gap-y-1">
                {item.relationship ? <Text className="text-sm text-muted-foreground">{item.relationship}</Text> : null}
                {item.phone ? <Text className="text-sm text-muted-foreground">{item.phone}</Text> : null}
                {item.email ? <Text className="text-sm text-muted-foreground">{item.email}</Text> : null}
              </View>

              {item.notes ? <Text className="text-sm text-muted-foreground">{item.notes}</Text> : null}

              <Button
                variant="outline"
                size="sm"
                className="self-start border-rose-200"
                labelClassName="text-rose-700"
                icon={<Trash2 size={16} color="#be123c" />}
                disabled={removeMutation.isPending}
                onPress={() => confirmRemove(item)}
              >
                Eliminar
              </Button>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
