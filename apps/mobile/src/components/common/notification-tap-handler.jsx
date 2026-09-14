import { useEffect } from "react";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useBiometricLock } from "@/components/common/biometric-gate";
import { consumePendingNavigation, subscribePendingNavigation } from "@/lib/pending-navigation";

/**
 * Abre la pantalla que dejo pendiente un push, cuando se puede.
 *
 * El toque lo guarda PushIntentCapture, que vive fuera de todas las puertas.
 * Este componente vive dentro: se monta detras del login y de los terminos, y
 * ademas espera a que el bloqueo biometrico este abierto. Solo entonces navega.
 *
 * Asi un push nunca se salta ninguna puerta, sea cual sea el estado de la app al
 * tocarlo, y la intencion no se pierde mientras alguna siga cerrada.
 */
export default function NotificationTapHandler() {
  const { user } = useAuth();
  const { locked } = useBiometricLock();
  const queryClient = useQueryClient();

  useEffect(() => {
    const attempt = () =>
      consumePendingNavigation({
        gates: {
          authenticated: Boolean(user),
          // Este componente solo existe dentro de TermsGate: si esta montado, los
          // terminos estan aceptados.
          termsAccepted: true,
          unlocked: !locked,
        },
        navigate: (route, entry) => {
          // Lo que anuncia el push ya existe en el servidor.
          queryClient.invalidateQueries({ queryKey: ["client-notifications"] });
          router.push(route);

          // Un aviso de correo lleva a la pieza o a la bandeja: se marca leido
          // aqui. Sin esperar: la navegacion no depende de ello.
          const readIds = entry?.readIds || [];
          if (readIds.length) {
            Promise.all(readIds.map((id) => api.patch("/client/notifications/" + encodeURIComponent(id) + "/read")))
              .then(() => queryClient.invalidateQueries({ queryKey: ["client-notifications"] }))
              .catch(() => {});
          }
        },
      });

    attempt();
    return subscribePendingNavigation(attempt);
  }, [user, locked, queryClient]);

  return null;
}
