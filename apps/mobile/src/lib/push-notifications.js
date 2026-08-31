import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";

import { api } from "@/lib/api";

/**
 * En Expo Go sobre Android, expo-notifications lanza nada mas importarse:
 * Expo retiro el push remoto de Expo Go en el SDK 53. Por eso el modulo se
 * carga bajo demanda y no arriba, o una sola importacion tumbaria la app al
 * arrancar.
 */
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

let notificationsModule;
let handlerReady = false;

function loadNotifications() {
  if (isExpoGo) return null;
  if (notificationsModule !== undefined) return notificationsModule;

  try {
    // eslint-disable-next-line global-require
    notificationsModule = require("expo-notifications");
  } catch (error) {
    notificationsModule = null;
  }

  return notificationsModule;
}

/**
 * Que hacer con un aviso que llega con la app abierta.
 *
 * Por defecto no se muestra nada en primer plano, y el cliente se quedaria sin
 * enterarse de un paquete recien registrado mientras mira otra pantalla.
 */
function ensureHandler(Notifications) {
  if (handlerReady || !Notifications) return;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  handlerReady = true;
}

/** El id del proyecto EAS es obligatorio para pedir el token. */
function getProjectId() {
  return Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId || null;
}

/**
 * Por que el registro puede no ser posible.
 *
 * Se devuelve el motivo y no un simple false para poder explicarlo: no es lo
 * mismo que el cliente haya dicho que no a que falte configurar el proyecto.
 */
export async function getPushSupport() {
  if (isExpoGo) {
    return { available: false, reason: "Las notificaciones necesitan un development build, no Expo Go." };
  }

  if (!loadNotifications()) {
    return { available: false, reason: "El módulo de notificaciones no está disponible." };
  }

  // El simulador no tiene servicio de notificaciones al que registrarse.
  if (!Device.isDevice) {
    return { available: false, reason: "Las notificaciones necesitan un dispositivo real." };
  }

  if (!getProjectId()) {
    return { available: false, reason: "El proyecto todavía no está enlazado con EAS." };
  }

  return { available: true };
}

/**
 * Pide permiso y registra el dispositivo.
 *
 * No lanza nunca: quedarse sin notificaciones no debe impedir usar la app.
 */
export async function registerForPush() {
  const support = await getPushSupport();
  if (!support.available) return { token: null, reason: support.reason };

  const Notifications = loadNotifications();

  try {
    ensureHandler(Notifications);

    // Android necesita un canal declarado o el aviso no se muestra.
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Avisos del buzón",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;

    // Solo se pregunta si el cliente no ha decidido antes: volver a pedirlo
    // tras un "no" no muestra nada y gasta la unica oportunidad en iOS.
    if (!granted && existing.canAskAgain) {
      const requested = await Notifications.requestPermissionsAsync();
      granted = requested.granted;
    }

    if (!granted) return { token: null, reason: "Permiso de notificaciones denegado." };

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: getProjectId() });
    await api.post("/client/push-devices", { token, platform: Platform.OS });

    return { token, reason: null };
  } catch (error) {
    return { token: null, reason: error?.message || "No se pudo registrar el dispositivo." };
  }
}

/**
 * Da de baja el dispositivo al cerrar sesion.
 *
 * Sin esto, el siguiente que entrara en este telefono seguiria recibiendo los
 * avisos de la cuenta anterior.
 */
export async function unregisterFromPush() {
  const support = await getPushSupport();
  if (!support.available) return;

  const Notifications = loadNotifications();

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: getProjectId() });
    await api.post("/client/push-devices/unregister", { token });
  } catch (error) {
    // Cerrar sesion no puede fallar porque el servidor no responda.
    console.warn("Unable to unregister push device", error?.message || error);
  }
}
