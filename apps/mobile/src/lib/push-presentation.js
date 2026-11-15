/**
 * Cuando se puede enseñar o registrar un push. Sin React ni expo, para probarlo.
 *
 * Privacidad:
 *   - Con la app delante y SIN sesion no se enseña ningun aviso (ni banner, ni
 *     sonido, ni contador). Puede llegar uno de la cuenta anterior si el
 *     `push-devices/unregister` del logout fallo por la red; el backend reasigna
 *     el token al siguiente login, pero hasta entonces no se pinta nada aqui.
 *   - Al cerrar sesion se vacia la bandeja del sistema (push-notifications).
 *   - Tocar un aviso nunca navega sin sesion, terminos y desbloqueo
 *     (pending-navigation); y un aviso tocado sin sesion se descarta al entrar
 *     otra cuenta (session-scope -> clearPendingNavigation).
 *   - Con la app en segundo plano o cerrada el sistema enseña el aviso tal cual:
 *     el texto lo decide el backend (sin datos sensibles: "You have a new mail
 *     item", estados de baja sin datos de la cuenta).
 */

let sessionActive = false;

export function setPushSessionActive(active) {
  sessionActive = Boolean(active);
}

export function isPushSessionActive() {
  return sessionActive;
}

/** Que hace un aviso que llega con la app delante. */
export function foregroundPresentation({ sessionActive: active } = {}) {
  const show = Boolean(active);
  return { shouldPlaySound: show, shouldSetBadge: show, shouldShowBanner: show, shouldShowList: show };
}

/**
 * Si este dispositivo puede registrarse para push, y si no, por que.
 *
 * `androidFcmConfigured`: la build lleva google-services.json de su marca
 * (app.config.js -> extra.push). Sin el, Android no tiene Firebase y
 * getExpoPushTokenAsync fallaria: se dice claro en vez de intentarlo.
 * `undefined` (una build anterior sin el dato) no bloquea.
 */
export function pushSupport({ isExpoGo, hasModule, isDevice, projectId, platform, androidFcmConfigured }) {
  if (isExpoGo) return { available: false, reason: "Notifications require a development build, not Expo Go." };
  if (!hasModule) return { available: false, reason: "The notifications module is not available." };
  if (!isDevice) return { available: false, reason: "Notifications require a physical device." };
  if (!projectId) return { available: false, reason: "This project is not linked to EAS yet." };
  if (platform === "android" && androidFcmConfigured === false) {
    return { available: false, reason: "Android notifications are not configured for this app yet (Firebase)." };
  }
  return { available: true, reason: null };
}
