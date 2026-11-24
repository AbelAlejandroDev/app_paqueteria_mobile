import { useCallback, useEffect, useState } from "react";
import { AppState, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { CloudOff, WifiOff } from "lucide-react-native";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { probeApi } from "@/lib/api";
import { brand } from "@/lib/brand";
import {
  confirmServiceDown,
  getServiceStatus,
  reportServiceRecovered,
  SERVICE_OK,
  startRecoveryLoop,
  subscribeServiceStatus,
} from "@/lib/service-status";

const COPY = {
  offline: {
    icon: WifiOff,
    title: "No internet connection",
    body: "Check your Wi-Fi or mobile data. We will reconnect automatically.",
  },
  timeout: {
    icon: CloudOff,
    title: "The server is taking too long",
    body: "Your connection may be slow, or the service is busy. We will keep trying.",
  },
  unavailable: {
    icon: CloudOff,
    title: "Service temporarily unavailable",
    body: "We are doing maintenance or having a temporary problem. We will reconnect automatically.",
  },
};

/**
 * Pantalla global de "servicio no disponible": sin red, timeout o una caida
 * del servidor (502/503/504 del proxy). La enciende el interceptor de
 * src/lib/api.js; la apaga la primera respuesta del backend.
 *
 * Va por encima de todo sin desmontar nada: lo que el cliente estaba
 * escribiendo sigue ahi al volver. No cierra la sesion ni borra los tokens.
 *
 * Solo se ensena si la caida esta CONFIRMADA (lib/service-status,
 * confirmServiceDown): un fallo suelto al abrir la app no basta. Con la app en
 * segundo plano no se confirma nada (iOS corta la red alli); se hace al volver.
 *
 * Mientras esta, sondea la API (sin sesion) con espera creciente y al volver a
 * primer plano. Al recuperarse vuelve a leer las consultas activas (GET) y, si
 * la sesion no se pudo comprobar al arrancar, la comprueba. Las operaciones que
 * fallaron (un pago, una peticion) NO se repiten: el cliente ve su estado real
 * y decide.
 */
export default function ServiceUnavailable() {
  const queryClient = useQueryClient();
  const { sessionUnavailable, reload } = useAuth();
  const [service, setService] = useState(getServiceStatus);
  const [checking, setChecking] = useState(false);
  // La caida (identificada por desde cuando dura, `since`) se ha comprobado con
  // una sonda propia, no solo con un fallo suelto. Una caida nueva tiene otro
  // `since`, asi que vuelve a necesitar su confirmacion.
  const [confirmedSince, setConfirmedSince] = useState(null);

  const failing = service.status !== SERVICE_OK;
  const confirmed = failing && confirmedSince !== null && confirmedSince === service.since;
  const down = failing && confirmed;
  const episode = failing ? service.since : null;

  useEffect(() => {
    if (episode === null) return undefined;
    let cancelled = false;
    const confirm = () =>
      confirmServiceDown({ probe: probeApi }).then((result) => {
        if (!cancelled && result === "down") setConfirmedSince(episode);
      });

    if (AppState.currentState === "active") {
      confirm();
      return () => {
        cancelled = true;
      };
    }
    // En segundo plano no: se confirma al volver a primer plano.
    const subscription = AppState.addEventListener("change", (appState) => {
      if (appState === "active") {
        subscription.remove();
        confirm();
      }
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [episode]);

  const onRecovered = useCallback(() => {
    queryClient.invalidateQueries({ type: "active" });
    if (sessionUnavailable) reload();
  }, [queryClient, reload, sessionUnavailable]);

  useEffect(() => {
    let previous = getServiceStatus().status;
    return subscribeServiceStatus((next) => {
      setService(next);
      if (previous !== SERVICE_OK && next.status === SERVICE_OK) onRecovered();
      previous = next.status;
    });
  }, [onRecovered]);

  useEffect(() => {
    if (!down) return undefined;

    const recovery = startRecoveryLoop({ probe: probeApi });

    const subscription = AppState.addEventListener("change", (appState) => {
      if (appState === "active") recovery.checkNow();
    });

    return () => {
      recovery.stop();
      subscription.remove();
    };
  }, [down]);

  if (!down) return null;

  const copy = COPY[service.status] || COPY.unavailable;
  const Icon = copy.icon;

  const tryAgain = async () => {
    setChecking(true);
    try {
      // Al responder, el bucle de arriba se para solo (down pasa a false).
      if (await probeApi()) reportServiceRecovered();
    } finally {
      setChecking(false);
    }
  };

  return (
    <View
      accessibilityRole="alert"
      className="absolute inset-0 items-center justify-center gap-4 bg-canvas px-8"
      style={{ zIndex: 1000, elevation: 1000 }}
    >
      <Icon size={40} color={brand.palette?.glyph || brand.primaryColor} />
      <Text className="text-center font-brand-semibold text-[18px] text-ink">{copy.title}</Text>
      <Text className="text-center font-brand text-[14px] leading-5 text-ink/70">{copy.body}</Text>
      <Text className="text-center font-brand text-[13px] leading-5 text-ink/60">
        You are still signed in. If you were making a payment or a request, check its status when we are back before
        trying again.
      </Text>
      <Button loading={checking} onPress={tryAgain}>
        Try again
      </Button>
    </View>
  );
}
