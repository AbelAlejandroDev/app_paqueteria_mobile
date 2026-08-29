import { useEffect, useState } from "react";
import { Alert, ScrollView, Switch, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { brand } from "@/lib/brand";
import { formatErrorMessage } from "@/lib/utils";
import EmptyState from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const ENDPOINT = "/client/notification-preferences";

/** Mismo criterio que el backend, para avisar antes de intentar guardar. */
function isValidUsPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;

  if (national.length !== 10) return false;
  return !/^[01]/.test(national) && !/^[01]/.test(national.slice(3));
}

/** "+13055551234" se lee mejor como "(305) 555-1234". */
function formatForDisplay(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return value || "";

  return "(" + national.slice(0, 3) + ") " + national.slice(3, 6) + "-" + national.slice(6);
}

export default function NotificationsScreen() {
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState("");
  const [dirty, setDirty] = useState(false);

  // Se consulta al entrar en esta pantalla, no al abrir Settings.
  const query = useQuery({
    queryKey: ["client-notification-preferences"],
    queryFn: async () => (await api.get(ENDPOINT)).data,
  });

  const serverPhone = query.data?.phone || "";

  useEffect(() => {
    // No se pisa lo que el usuario esté escribiendo.
    if (!dirty) setPhone(formatForDisplay(serverPhone));
  }, [serverPhone, dirty]);

  const save = useMutation({
    mutationFn: async (payload) => (await api.patch(ENDPOINT, payload)).data,
    onSuccess: (data) => {
      queryClient.setQueryData(["client-notification-preferences"], data);
      setDirty(false);
      setPhone(formatForDisplay(data?.phone));
    },
    onError: (error) => {
      Alert.alert("No se pudo guardar", formatErrorMessage(error, "Unable to save notification settings"));
    },
  });

  if (query.isLoading) {
    return (
      <View className="flex-1 gap-4 bg-background p-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-40 w-full" />
      </View>
    );
  }

  if (query.isError) {
    return (
      <View className="flex-1 gap-4 bg-background p-4">
        <EmptyState title="No se pudieron cargar las notificaciones" description={formatErrorMessage(query.error)} />
        <Button variant="outline" onPress={() => query.refetch()}>
          Reintentar
        </Button>
      </View>
    );
  }

  const enabled = Boolean(query.data?.textAlertsEnabled);
  const phoneIsValid = isValidUsPhone(phone);
  const smsAvailable = Boolean(query.data?.channels?.sms?.available);

  const toggleAlerts = (next) => {
    if (next && !phoneIsValid) {
      Alert.alert("Falta el teléfono", "Añade y guarda un número válido antes de activar los avisos por SMS.");
      return;
    }

    save.mutate({ textAlertsEnabled: next });
  };

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-4 pb-24">
      <Card>
        <CardContent className="gap-4 p-5">
          <View className="flex-row items-start justify-between gap-3">
            <View className="min-w-0 flex-1">
              <Text className="text-base font-medium text-foreground">Text Alerts</Text>
              <Text className="mt-1 text-sm leading-5 text-muted-foreground">
                Avisos por SMS cuando llegue correspondencia nueva.
              </Text>
            </View>
            <Switch
              value={enabled}
              // Sin teléfono válido no se puede activar; apagarlo siempre se puede.
              disabled={save.isPending || (!enabled && !phoneIsValid)}
              onValueChange={toggleAlerts}
              trackColor={{ true: brand.primaryColor, false: "#cbd5e1" }}
              thumbColor="#ffffff"
            />
          </View>

          {!phoneIsValid ? (
            <Text className="text-sm leading-5 text-amber-800">
              Añade un número de teléfono válido para poder activarlos.
            </Text>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="gap-4 p-5">
          <Field label="Phone Number">
            <Input
              value={phone}
              onChangeText={(value) => {
                setDirty(true);
                setPhone(value);
              }}
              keyboardType="phone-pad"
              placeholder="(305) 555-1234"
            />
          </Field>

          <Button
            loading={save.isPending}
            disabled={!dirty || (phone.trim() !== "" && !phoneIsValid)}
            onPress={() => save.mutate({ phone: phone.trim() === "" ? null : phone })}
          >
            Guardar teléfono
          </Button>

          <Text className="text-xs leading-4 text-muted-foreground">
            Se guarda en formato internacional. Desactivar los avisos no borra el número.
          </Text>
        </CardContent>
      </Card>

      {!smsAvailable ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-5">
            <Text className="text-sm leading-5 text-amber-900">
              {query.data?.channels?.sms?.reason
                || "El envío de SMS todavía no está configurado."}{" "}
              Tu preferencia queda guardada y se aplicará cuando el centro lo active.
            </Text>
          </CardContent>
        </Card>
      ) : null}
    </ScrollView>
  );
}
