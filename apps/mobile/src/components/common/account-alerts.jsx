import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, Info } from "lucide-react-native";

import { api } from "@/lib/api";

/**
 * Estado de la cuenta que el cliente deberia saber nada mas entrar: mora, un
 * escaneo esperando pago, una baja en curso o el 1583 sin aprobar.
 *
 * Van en linea y no en una ventana a proposito. El backend ya marca cual de
 * ellas bloquea de verdad, y para interrumpir ya esta el aviso de cobro
 * fallido: dos ventanas seguidas al abrir la app se cierran sin leerse, y
 * entonces no llega tampoco la que importa.
 */
const TONES = {
  critical: {
    container: "border-rose-200 bg-rose-50",
    title: "text-rose-900",
    body: "text-rose-800",
    icon: "#be123c",
  },
  warning: {
    container: "border-amber-200 bg-amber-50",
    title: "text-amber-900",
    body: "text-amber-800",
    icon: "#b45309",
  },
  info: {
    container: "border-sky-200 bg-sky-50",
    title: "text-sky-900",
    body: "text-sky-800",
    icon: "#0369a1",
  },
};

/**
 * Las rutas del aviso son las del portal web. Se traducen aqui porque la app
 * no tiene las mismas pantallas: los escaneos pendientes no son una lista
 * propia, viven en la carpeta Pending del correo.
 */
const ROUTES = {
  "/client/billing": "/billing",
  "/client/settings": "/settings",
  "/client/usps-verification": "/usps-verification",
  "/client/service-requests": { pathname: "/mail-items", params: { folder: "pending" } },
};

function AlertCard({ alert }) {
  const tone = TONES[alert.severity] || TONES.info;
  const Icon = alert.severity === "info" ? Info : AlertTriangle;
  const route = ROUTES[alert.actionHref];

  const content = (
    <View className={"flex-row items-start gap-3 rounded-lg border p-4 " + tone.container}>
      <Icon size={20} color={tone.icon} style={{ marginTop: 2 }} />
      <View className="min-w-0 flex-1">
        <Text className={"text-sm font-semibold " + tone.title}>{alert.title}</Text>
        <Text className={"mt-1 text-sm leading-5 " + tone.body}>{alert.message}</Text>
        {/* Solo se anuncia la accion si se puede llegar: un enlace que no
            navega es peor que no ofrecerlo. */}
        {route && alert.actionLabel ? (
          <Text className={"mt-2 text-sm font-medium " + tone.title}>{alert.actionLabel}</Text>
        ) : null}
      </View>
      {route ? <ChevronRight size={18} color={tone.icon} style={{ marginTop: 2 }} /> : null}
    </View>
  );

  if (!route) return content;

  return (
    <Pressable onPress={() => router.push(route)} className="active:opacity-80">
      {content}
    </Pressable>
  );
}

export default function AccountAlerts() {
  const query = useQuery({
    queryKey: ["client-account-alerts"],
    queryFn: async () => (await api.get("/client/account-alerts")).data,
    // Quedarse sin el aviso es malo, pero reintentar en bucle desde la pantalla
    // de inicio es peor.
    retry: 1,
  });

  const alerts = query.data?.alerts || [];
  if (!alerts.length) return null;

  return (
    <View className="gap-3">
      {alerts.map((alert) => (
        <AlertCard key={alert.type} alert={alert} />
      ))}
    </View>
  );
}
