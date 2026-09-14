import { useEffect } from "react";

import { addNotificationTapListener, takeInitialNotificationTap } from "@/lib/push-notifications";
import { navigationKeyFor, routeForNotification } from "@/lib/notification-routing";
import { setPendingNavigation } from "@/lib/pending-navigation";

/**
 * Guarda a donde queria ir el cliente al tocar un push. No navega.
 *
 * Va en la raiz, fuera del login, los terminos y el bloqueo, para no perder el
 * toque aunque llegue con la app cerrada, sin sesion o bloqueada. Quien navega es
 * NotificationTapHandler, desde dentro de todas las puertas.
 *
 * Cubre las tres situaciones: con la app delante o en segundo plano el toque
 * llega por el listener; con la app cerrada ya ocurrio antes de montar y se lee
 * al arrancar. Si llega por las dos vias, la clave evita abrirlo dos veces.
 */
export default function PushIntentCapture() {
  useEffect(() => {
    const capture = (data, requestId) => {
      setPendingNavigation({
        route: routeForNotification(data),
        key: navigationKeyFor(data, requestId),
      });
    };

    let active = true;
    takeInitialNotificationTap().then((tap) => {
      if (active && tap) capture(tap.data, tap.id);
    });

    const unsubscribe = addNotificationTapListener(capture);

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return null;
}
