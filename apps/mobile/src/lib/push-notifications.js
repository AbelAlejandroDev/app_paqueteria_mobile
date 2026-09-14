import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";

import { api } from "@/lib/api";
import { MAIL_RECEIVED_TYPE, staleMailNotificationIds } from "@/lib/mail-notifications";

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
    return { available: false, reason: "Notifications require a development build, not Expo Go." };
  }

  if (!loadNotifications()) {
    return { available: false, reason: "The notifications module is not available." };
  }

  // El simulador no tiene servicio de notificaciones al que registrarse.
  if (!Device.isDevice) {
    return { available: false, reason: "Notifications require a physical device." };
  }

  if (!getProjectId()) {
    return { available: false, reason: "This project is not linked to EAS yet." };
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
        name: "Mailbox alerts",
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

    if (!granted) return { token: null, reason: "Notification permission denied." };

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: getProjectId() });
    await api.post("/client/push-devices", { token, platform: Platform.OS });

    return { token, reason: null };
  } catch (error) {
    return { token: null, reason: error?.message || "The device could not be registered." };
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

function dataFromResponse(response) {
  return response?.notification?.request?.content?.data || null;
}

/**
 * Avisa cuando el cliente toca una notificacion con la app abierta o en
 * segundo plano. Devuelve la funcion para dejar de escuchar.
 *
 * En Expo Go no hay modulo y no se escucha nada: tampoco llegarian pushes.
 */
export function addNotificationTapListener(onTap) {
  const Notifications = loadNotifications();
  if (!Notifications) return () => {};

  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    onTap(dataFromResponse(response), response?.notification?.request?.identifier || null);
  });

  return () => subscription.remove();
}

/**
 * El toque que abrio la app desde cerrada.
 *
 * El listener no lo recibe: se registra despues de que el toque ya ocurrio.
 * Se borra al leerlo para que volver al panel no reabra la misma notificacion.
 */
export async function takeInitialNotificationTap() {
  const Notifications = loadNotifications();
  if (!Notifications) return null;

  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    if (!response) return null;

    await Notifications.clearLastNotificationResponseAsync();
    return {
      data: dataFromResponse(response),
      id: response?.notification?.request?.identifier || null,
    };
  } catch {
    // Leer la ultima respuesta no puede impedir que la app arranque.
    return null;
  }
}

/**
 * Avisa cuando llega un push con la app delante. Devuelve la funcion para dejar
 * de escuchar.
 */
export function addNotificationReceivedListener(onReceive) {
  const Notifications = loadNotifications();
  if (!Notifications) return () => {};

  const subscription = Notifications.addNotificationReceivedListener((notification) => {
    onReceive(notification?.request?.content?.data || null);
  });

  return () => subscription.remove();
}

/**
 * Deja en la bandeja del sistema un solo aviso de correo, el mas reciente.
 *
 * Expo Push no permite que un push sustituya a otro, asi que "You have 2 new mail
 * items" llega junto al "You have a new mail item" anterior. Cuando la app corre
 * --al llegar uno con la app delante o al volver a ella-- se retiran los viejos.
 * Con la app cerrada no corre nada y se quedan hasta entonces.
 */
export async function dismissStaleMailNotifications() {
  const Notifications = loadNotifications();
  if (!Notifications) return;

  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(staleMailNotificationIds(presented).map((id) => Notifications.dismissNotificationAsync(id)));
  } catch {
    // Limpiar la bandeja es cosmetico: nunca debe romper nada.
  }
}

/** Al abrir el correo desde un aviso, los demas avisos de correo ya estan vistos. */
export async function dismissAllMailNotifications() {
  const Notifications = loadNotifications();
  if (!Notifications) return;

  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    const ids = presented
      .filter((entry) => entry?.request?.content?.data?.type === MAIL_RECEIVED_TYPE)
      .map((entry) => entry.request.identifier);
    await Promise.all(ids.map((id) => Notifications.dismissNotificationAsync(id)));
  } catch {
    // Igual que arriba.
  }
}
