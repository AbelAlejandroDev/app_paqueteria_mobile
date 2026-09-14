import { useEffect } from "react";
import { AppState } from "react-native";

import {
  addNotificationReceivedListener,
  addNotificationTapListener,
  dismissAllMailNotifications,
  dismissStaleMailNotifications,
  takeInitialNotificationTap,
} from "@/lib/push-notifications";
import { isMailReceived } from "@/lib/mail-notifications";
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
 *
 * Tambien mantiene en la bandeja del sistema un solo aviso de correo: los avisos
 * apilados ("You have 2 new mail items") no sustituyen al anterior por si solos.
 */
export default function PushIntentCapture() {
  useEffect(() => {
    const capture = (data, requestId) => {
      const mail = isMailReceived(data);

      setPendingNavigation({
        route: routeForNotification(data),
        key: navigationKeyFor(data, requestId),
        // Un aviso de correo no abre su detalle, que es donde se marcan leidos.
        readIds: mail && data?.notificationId ? [String(data.notificationId)] : [],
      });

      if (mail) dismissAllMailNotifications();
    };

    let active = true;
    takeInitialNotificationTap().then((tap) => {
      if (active && tap) capture(tap.data, tap.id);
    });

    const unsubscribeTap = addNotificationTapListener(capture);

    const unsubscribeReceived = addNotificationReceivedListener((data) => {
      if (isMailReceived(data)) dismissStaleMailNotifications();
    });

    // Lo que llego con la app cerrada o en segundo plano se ordena al volver.
    dismissStaleMailNotifications();
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") dismissStaleMailNotifications();
    });

    return () => {
      active = false;
      unsubscribeTap();
      unsubscribeReceived();
      appState.remove();
    };
  }, []);

  return null;
}
