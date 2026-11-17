/**
 * Registro del dispositivo para push (POST /client/push-devices). Sin React ni
 * expo, para poder probarlo; lo usa lib/push-notifications.
 *
 * Contrato (backend `feat/push-receipts-hardening`, docs/mobile/api-cliente.md §10):
 *   { token, platform, projectId }  ->  201 { id, platform, lastSeenAt }
 *   - `projectId`: el proyecto de EAS de la app. Si el tenant tiene
 *     EXPO_PROJECT_ID__<TENANT> y no coincide: 422 PUSH_PROJECT_MISMATCH.
 *   - Volver a registrar reactiva un dispositivo desactivado (DeviceNotRegistered).
 *
 * Backend anterior (HDG Sandbox `backend-348c327` hoy): el cuerpo es estricto y
 * NO conoce `projectId`, asi que responde 400 "Invalid body" con
 * "Unrecognized key(s) in object: 'projectId'". Solo en ESE caso se repite una
 * vez sin `projectId`. La marca se sigue comprobando aqui antes de enviar nada
 * (resolvePushProjectId), asi que la compatibilidad no abre la puerta a otra app.
 */

export const PUSH_DEVICES_PATH = "/client/push-devices";
export const PUSH_DEVICES_UNREGISTER_PATH = "/client/push-devices/unregister";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resultados de registerPushDevice. */
export const REGISTERED = "registered";
export const REGISTERED_LEGACY = "registered-legacy";
export const PROJECT_MISMATCH = "project-mismatch";
export const INVALID_TOKEN = "invalid-token";
export const FAILED = "failed";

const normalizeId = (value) => (typeof value === "string" ? value.trim().toLowerCase() : "");

/**
 * El projectId con el que pedir el token y registrarse, comprobado contra la
 * marca de la build.
 *
 * Fuentes en una build real: `Constants.expoConfig.extra.eas.projectId` (lo pone
 * app.config.js desde brands/index.js, y viaja tambien en el manifiesto de cada
 * OTA) y `Constants.easConfig.projectId` (lo pone EAS Build). Todas las que
 * existan tienen que ser la de la marca: si una dice otra cosa, la build esta
 * mal hecha y no se registra nada (mejor sin push que con el proyecto de otra
 * marca).
 *
 * @returns {{ projectId: string|null, reason: string|null }}
 */
export function resolvePushProjectId({ expoConfigProjectId, easConfigProjectId, brandProjectId } = {}) {
  const expected = normalizeId(brandProjectId);
  if (!UUID.test(expected)) return { projectId: null, reason: "This project is not linked to EAS yet." };

  const sources = [expoConfigProjectId, easConfigProjectId].map(normalizeId).filter(Boolean);
  if (!sources.length) return { projectId: null, reason: "This project is not linked to EAS yet." };
  if (sources.some((id) => id !== expected)) {
    return { projectId: null, reason: "This build is linked to another app's notification project." };
  }
  return { projectId: expected, reason: null };
}

/** Si el 400 es justo el del backend anterior que no conoce `projectId`. */
export function isLegacyProjectIdRejection(error) {
  if (error?.response?.status !== 400) return false;
  const details = error.response.data?.details;
  if (!details) return false;
  const text = JSON.stringify(details);
  return /unrecognized key/i.test(text) && /projectId/.test(text);
}

function errorCode(error) {
  return error?.response?.data?.code || null;
}

/**
 * Registra el token. Nunca reintenta por su cuenta salvo el caso del backend
 * anterior (una vez, sin projectId). Nunca lanza.
 *
 * @returns {Promise<{ status: string, reason: string|null }>}
 */
export async function registerPushDevice(api, { token, platform, projectId }) {
  const body = { token, platform, ...(projectId ? { projectId } : {}) };
  try {
    await api.post(PUSH_DEVICES_PATH, body);
    return { status: REGISTERED, reason: null };
  } catch (error) {
    const code = errorCode(error);
    if (code === "PUSH_PROJECT_MISMATCH") {
      return { status: PROJECT_MISMATCH, reason: "This app is not allowed to receive notifications for this account." };
    }
    if (code === "INVALID_PUSH_TOKEN") return { status: INVALID_TOKEN, reason: "The notification token was rejected." };
    if (projectId && isLegacyProjectIdRejection(error)) {
      try {
        await api.post(PUSH_DEVICES_PATH, { token, platform });
        return { status: REGISTERED_LEGACY, reason: null };
      } catch (legacyError) {
        return { status: FAILED, reason: describeError(legacyError) };
      }
    }
    return { status: FAILED, reason: describeError(error) };
  }
}

function describeError(error) {
  const status = error?.response?.status;
  if (!status) return "The device could not be registered (no connection).";
  return `The device could not be registered (HTTP ${status}${errorCode(error) ? " " + errorCode(error) : ""}).`;
}

/**
 * Cuando registrar. Una sola peticion a la vez y sin repetir lo ya hecho en
 * esta ejecucion de la app:
 *   - mismo usuario + mismo token + mismo proyecto ya registrado -> no se repite
 *     (salvo `force`: token nuevo de Expo o renovacion);
 *   - PUSH_PROJECT_MISMATCH para ese usuario y proyecto -> no se vuelve a
 *     intentar hasta reiniciar la app (no hay forma de que cambie solo);
 *   - dos llamadas a la vez para lo mismo comparten la misma peticion.
 * Un fallo de red no deja nada marcado: el siguiente arranque o token lo reintenta.
 */
export function createPushRegistrationGate({ renewAfterMs = 24 * 60 * 60 * 1000, now = () => Date.now() } = {}) {
  let registered = null; // { key, at }
  const blocked = new Set();
  const inFlight = new Map();

  return {
    async run({ userId, token, projectId, force = false }, register) {
      if (!userId || !token) return { status: FAILED, reason: "No session or token.", skipped: true };
      const key = `${userId}|${projectId || ""}|${token}`;
      const blockKey = `${userId}|${projectId || ""}`;

      if (blocked.has(blockKey)) return { status: PROJECT_MISMATCH, reason: "Blocked for this session.", skipped: true };
      if (!force && registered?.key === key && now() - registered.at < renewAfterMs) {
        return { status: REGISTERED, reason: null, skipped: true };
      }
      if (inFlight.has(key)) return inFlight.get(key);

      const promise = (async () => {
        const result = await register();
        if (result.status === REGISTERED || result.status === REGISTERED_LEGACY) registered = { key, at: now() };
        if (result.status === PROJECT_MISMATCH) blocked.add(blockKey);
        return result;
      })().finally(() => inFlight.delete(key));
      inFlight.set(key, promise);
      return promise;
    },
    /** Al cerrar sesion o cambiar de cuenta: lo de la anterior no vale. */
    reset() {
      registered = null;
      blocked.clear();
      inFlight.clear();
    },
  };
}

/** Para logs: nunca el token entero ("ExponentPushToken[ab…yz]"). */
export function maskPushToken(token) {
  const text = String(token || "");
  const match = /^(Expo(?:nent)?PushToken)\[(.*)\]$/.exec(text);
  if (!match) return text ? "[token]" : "";
  const inner = match[2];
  return inner.length > 6 ? `${match[1]}[${inner.slice(0, 2)}…${inner.slice(-2)}]` : `${match[1]}[…]`;
}
