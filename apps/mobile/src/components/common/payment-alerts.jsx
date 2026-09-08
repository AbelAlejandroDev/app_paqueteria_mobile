import { useState } from "react";
import { Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { formatMoneyFromCents } from "@/lib/mail-item-detail";
import { Button } from "@/components/ui/button";
import { Modal, Notice } from "@/components/ui/modal";

/**
 * Aviso de cobro fallido, en una ventana al entrar.
 *
 * Un pago que falla deja el servicio parado, asi que no puede esperar a que el
 * cliente abra su lista de notificaciones: se le enseña nada mas entrar.
 *
 * Cerrar la ventana llama a `acknowledge`, que no marca el aviso como leido ni
 * salda la deuda -- solo evita que vuelva a saltar por lo mismo. El aviso sigue
 * en la lista hasta que se pague.
 */
export default function PaymentAlerts() {
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState(() => new Set());

  const query = useQuery({
    queryKey: ["client-payment-alerts"],
    queryFn: async () => (await api.get("/client/payment-alerts")).data?.alerts || [],
    // Si falla no se reintenta en bucle: quedarse sin el aviso es malo, pero
    // machacar la API en cada pantalla es peor.
    retry: 1,
  });

  const acknowledge = useMutation({
    mutationFn: async (id) => (await api.patch("/client/notifications/" + id + "/acknowledge")).data,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["client-payment-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["client-notifications"] });
    },
  });

  const alerts = query.data || [];
  const alert = alerts.find((entry) => !dismissed.has(entry.id));

  if (!alert) return null;

  const close = () => {
    // Se oculta en el acto y el reconocimiento viaja despues: si la red falla,
    // el cliente no se queda con una ventana que no se cierra.
    setDismissed((current) => new Set(current).add(alert.id));
    acknowledge.mutate(alert.id);
  };

  const openInvoice = async () => {
    if (alert.invoiceUrl) {
      // La URL la da Stripe dentro del aviso; no se compone aqui.
      await WebBrowser.openBrowserAsync(alert.invoiceUrl);
    }
    close();
  };

  return (
    <Modal
      visible
      onClose={close}
      title={alert.title || "Payment needed"}
      footer={
        <>
          {alert.invoiceUrl ? <Button onPress={openInvoice}>Pay now</Button> : null}
          <Button variant="outline" onPress={close}>
            {alert.invoiceUrl ? "Later" : "Got it"}
          </Button>
        </>
      }
    >
      <Notice tone="amber">{alert.message}</Notice>

      {alert.amountCents != null ? (
        <View className="flex-row items-center justify-between gap-3 rounded-lg border border-border bg-background p-3">
          <Text className="text-sm text-muted-foreground">Amount due</Text>
          <Text className="text-base font-semibold text-foreground">
            {formatMoneyFromCents(alert.amountCents)}
          </Text>
        </View>
      ) : null}

      <Text className="text-xs leading-4 text-muted-foreground">
        {alert.invoiceUrl
          ? "Payment opens in a secure Stripe page. Your service resumes once it goes through."
          : "Contact your center to settle this and resume your service."}
      </Text>
    </Modal>
  );
}
