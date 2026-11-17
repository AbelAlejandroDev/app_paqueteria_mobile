import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";

import { api } from "@/lib/api";
import { brand } from "@/lib/brand";
import { MAIL_RECEIVED_TYPE, staleMailNotificationIds } from "@/lib/mail-notifications";
import { getJsonValue, setJsonValue } from "@paqueteria/core";
import {
  foregroundPresentation,
  isPushSessionActive,
  logoutPushCleanup,
  PUSH_LOCAL_UNREGISTER_PENDING_KEY,
  pushSupport,
  retryPendingPushCleanup,
  sessionLossPushCleanup,
} from "@/lib/push-presentation";
import {
  createPushRegistrationGate,
  PUSH_DEVICES_UNREGISTER_PATH,
  registerPushDevice,
  REGISTERED,
  REGISTERED_LEGACY,
  resolvePushProjectId,
} from "@/lib/push-registration";
import { BRANDS } from "../../brands";

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

  // Sin sesion no se enseña nada con la app delante (lib/push-presentation).
  Notifications.setNotificationHandler({
    handleNotification: async () => foregroundPresentation({ sessionActive: isPushSessionActive() }),
  });

  handlerReady = true;
}

/**
 * El proyecto EAS con el que pedir el token y registrarse: el de la config de
 * la build (y el que pone EAS Build), comprobados contra el catalogo de marcas
 * del propio bundle (lib/push-registration, resolvePushProjectId).
 */
function getProjectResolution() {
  return resolvePushProjectId({
    expoConfigProjectId: Constants.expoConfig?.extra?.eas?.projectId,
    easConfigProjectId: Constants.easConfig?.projectId,
    brandProjectId: BRANDS[brand.id]?.easProjectId,
  });
}

function getProjectId() {
  return getProjectResolution().projectId;
}

// Una peticion a la vez, sin repetir lo hecho y sin insistir tras
// PUSH_PROJECT_MISMATCH (lib/push-registration).
const registrationGate = createPushRegistrationGate();

/**
 * Por que el registro puede no ser posible.
 *
 * Se devuelve el motivo y no un simple false para poder explicarlo: no es lo
 * mismo que el cliente haya dicho que no a que falte configurar el proyecto.
 */
export async function getPushSupport() {
  // El simulador no tiene servicio de notificaciones al que registrarse; una
  // build de Android sin google-services.json de su marca, tampoco.
  const project = getProjectResolution();
  if (!project.projectId && project.reason && !isExpoGo) return { available: false, reason: project.reason };
  return pushSupport({
    isExpoGo,
    hasModule: !isExpoGo && Boolean(loadNotifications()),
    isDevice: Device.isDevice,
    projectId: project.projectId,
    platform: Platform.OS,
    androidFcmConfigured: Constants.expoConfig?.extra?.push?.androidFcmConfigured,
  });
}

/**
 * Pide permiso y registra el dispositivo con el usuario de la sesion.
 *
 * Se llama al haber sesion (login o arranque con sesion guardada) y con
 * `force` cuando Expo da un token nuevo. No lanza nunca: quedarse sin
 * notificaciones no debe impedir usar la app. Nunca devuelve ni registra en
 * logs el token entero.
 */
export async function registerForPush({ userId, force = false } = {}) {
  const support = await getPushSupport();
  if (!support.available) return { registered: false, status: null, reason: support.reason };

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

    // Sin permiso no se pide token ni se registra nada; se vuelve a mirar en el
    // siguiente arranque con sesion (el cliente puede activarlo en Ajustes).
    if (!granted) return { registered: false, status: null, reason: "Notification permission denied." };

    const projectId = getProjectId();
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const result = await registrationGate.run({ userId, token, projectId, force }, () =>
      registerPushDevice(api, { token, platform: Platform.OS, projectId })
    );

    const registered = result.status === REGISTERED || result.status === REGISTERED_LEGACY;
    // El token ya es de esta cuenta: una baja local pendiente no hace falta.
    if (registered) setJsonValue(PUSH_LOCAL_UNREGISTER_PENDING_KEY, null).catch(() => {});

    return { registered, status: result.status, reason: result.reason, skipped: Boolean(result.skipped) };
  } catch (error) {
    return { registered: false, status: null, reason: error?.message || "The device could not be registered." };
  }
}

/**
 * Expo/FCM/APNs pueden rotar el token con la app abierta. Devuelve la funcion
 * para dejar de escuchar. El token que llega es el nativo: el de Expo se vuelve
 * a pedir en registerForPush.
 */
export function addPushTokenChangeListener(onChange) {
  const Notifications = loadNotifications();
  if (!Notifications?.addPushTokenListener) return () => {};
  const subscription = Notifications.addPushTokenListener(() => onChange());
  return () => subscription.remove();
}

/** Lo registrado en esta ejecucion es de la cuenta que sale. */
export function resetPushRegistration() {
  registrationGate.reset();
}

/**
 * La sesion la cerro el servidor (revocada, 401) o era de otra organizacion:
 * ya no se puede llamar a `unregister` con ella, asi que el token se invalida
 * en el dispositivo. Asi los avisos de esa cuenta dejan de llegar aqui (el
 * backend desactiva el token con DeviceNotRegistered) y el siguiente login
 * pide uno nuevo. No lanza.
 */
export async function invalidatePushOnSessionLoss() {
  registrationGate.reset();
  const Notifications = loadNotifications();
  if (!Notifications) return { local: "skipped", pending: false };
  const support = await getPushSupport();
  if (!support.available) return { local: "skipped", pending: false };
  return sessionLossPushCleanup({
    unregisterLocally: () => Notifications.unregisterForNotificationsAsync(),
    markPending: () => setJsonValue(PUSH_LOCAL_UNREGISTER_PENDING_KEY, { at: new Date().toISOString() }),
    clearPending: () => setJsonValue(PUSH_LOCAL_UNREGISTER_PENDING_KEY, null),
  });
}

/**
 * Da de baja el dispositivo al cerrar sesion.
 *
 * Sin esto, el siguiente que entrara en este telefono seguiria recibiendo los
 * avisos de la cuenta anterior.
 */
export async function unregisterFromPush() {
  registrationGate.reset();
  const support = await getPushSupport();
  if (!support.available) return { server: false, local: "skipped", pending: false };

  const Notifications = loadNotifications();

  // Primero el servidor; si no responde, el token se invalida en el dispositivo
  // (lib/push-presentation, logoutPushCleanup). Cerrar sesion nunca falla por esto.
  const result = await logoutPushCleanup({
    unregisterOnServer: async () => {
      const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: getProjectId() });
      await api.post(PUSH_DEVICES_UNREGISTER_PATH, { token });
    },
    unregisterLocally: () => Notifications.unregisterForNotificationsAsync(),
    markPending: () => setJsonValue(PUSH_LOCAL_UNREGISTER_PENDING_KEY, { at: new Date().toISOString() }),
    clearPending: () => setJsonValue(PUSH_LOCAL_UNREGISTER_PENDING_KEY, null),
  });
  if (!result.server) console.warn("[push] baja sin servidor:", result.local === true ? "token invalidado en el dispositivo" : "pendiente");
  return result;
}

/** Al arrancar sin sesion: termina una baja local que quedo pendiente. */
export async function retryPendingPushUnregister() {
  const Notifications = loadNotifications();
  if (!Notifications) return "none";
  return retryPendingPushCleanup({
    isPending: async () => Boolean(await getJsonValue(PUSH_LOCAL_UNREGISTER_PENDING_KEY)),
    unregisterLocally: () => Notifications.unregisterForNotificationsAsync(),
    clearPending: () => setJsonValue(PUSH_LOCAL_UNREGISTER_PENDING_KEY, null),
  });
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

/**
 * Al cerrar sesion: fuera de la bandeja todo lo de la cuenta que sale, y el
 * contador a cero. Asi un aviso de una cuenta no queda a mano de la siguiente.
 */
export async function dismissAllNotifications() {
  const Notifications = loadNotifications();
  if (!Notifications) return;

  try {
    await Notifications.dismissAllNotificationsAsync();
    await Notifications.setBadgeCountAsync(0);
  } catch {
    // Limpiar la bandeja nunca debe impedir cerrar la sesion.
  }
}
