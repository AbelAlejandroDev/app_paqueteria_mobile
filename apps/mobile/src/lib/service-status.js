/**
 * Estado global del servicio: si la API responde o no.
 *
 * Lo alimenta el interceptor de src/lib/api.js con cada respuesta, y lo lee la
 * pantalla de "servicio no disponible" (components/common/service-unavailable).
 * Sin React para poder probarlo.
 *
 * Nada de aqui toca la sesion: estar sin servicio no es estar sin sesion. Los
 * tokens y el usuario guardado se quedan; al volver la API, la app sigue donde
 * estaba.
 */
import { AVAILABILITY_OFFLINE, AVAILABILITY_TIMEOUT, AVAILABILITY_UNAVAILABLE, classifyAvailability } from "@paqueteria/core";

export const SERVICE_OK = "ok";

const INITIAL = { status: SERVICE_OK, reason: null, since: null };

let state = INITIAL;
const listeners = new Set();

function publish(next) {
  state = next;
  listeners.forEach((listener) => listener(state));
}

export function getServiceStatus() {
  return state;
}

export function subscribeServiceStatus(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Una peticion fallo por algo que si habla del servicio (sin red, timeout, caida). */
export function reportServiceFailure(reason, now = Date.now()) {
  if (![AVAILABILITY_OFFLINE, AVAILABILITY_TIMEOUT, AVAILABILITY_UNAVAILABLE].includes(reason)) return state;
  // Mientras siga caido, se conserva desde cuando, y el motivo mas reciente.
  publish({ status: reason, reason, since: state.status === SERVICE_OK ? now : state.since });
  return state;
}

/** Llego una respuesta del backend: el servicio esta disponible. */
export function reportServiceRecovered() {
  if (state.status === SERVICE_OK) return state;
  publish(INITIAL);
  return state;
}

/**
 * Lo que dice un error del servicio. Devuelve el motivo si lo marco como no
 * disponible, o null si el error es de esa peticion (y entonces la API respondio).
 */
export function reportFromError(error) {
  const reason = classifyAvailability(error);
  if (reason) {
    reportServiceFailure(reason);
    return reason;
  }
  // Un 4xx o un 5xx con el JSON del backend: la API esta viva.
  if (error?.response) reportServiceRecovered();
  return null;
}

/**
 * Espera entre comprobaciones automaticas de GET /health mientras no hay
 * servicio: 2 s, 5 s, 15 s, 30 s y despues cada 60 s (la que recomienda el
 * backend, docs/mobile/capacidades-y-health.md §2). "Try again" comprueba ya.
 */
const PROBE_DELAYS_MS = [2000, 5000, 15000, 30000, 60000];

export function nextProbeDelay(attempt) {
  const index = Math.max(0, Math.min(Number(attempt) || 0, PROBE_DELAYS_MS.length - 1));
  return PROBE_DELAYS_MS[index];
}

/** Solo para tests. */
export function resetServiceStatusForTests() {
  state = INITIAL;
  listeners.clear();
}

/**
 * Comprueba la API con `probe` hasta que responda, con la espera de
 * nextProbeDelay, y entonces llama a `onRecovered`. Devuelve `{ stop, checkNow }`.
 *
 * Solo sondea: no repite ninguna peticion de la app. Al recuperarse, la
 * pantalla vuelve a leer las consultas (GET); las mutaciones no se repiten.
 * `schedule`/`cancel` son setTimeout/clearTimeout (inyectables para los tests).
 */
export function startRecoveryLoop({
  probe,
  onRecovered = reportServiceRecovered,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  let attempt = 0;
  let timer = null;
  let stopped = false;
  let inFlight = null;

  const tick = async () => {
    if (stopped) return false;
    if (inFlight) return inFlight;

    inFlight = (async () => {
      let ok = false;
      try {
        ok = Boolean(await probe());
      } catch {
        ok = false;
      }
      return ok;
    })();

    const ok = await inFlight;
    inFlight = null;
    if (stopped) return ok;

    if (ok) {
      stopped = true;
      onRecovered();
      return true;
    }

    attempt += 1;
    timer = schedule(tick, nextProbeDelay(attempt));
    return false;
  };

  timer = schedule(tick, nextProbeDelay(0));

  return {
    stop() {
      stopped = true;
      cancel(timer);
    },
    /** "Try again": comprueba ya, sin esperar al siguiente intento. */
    checkNow() {
      cancel(timer);
      return tick();
    },
  };
}
