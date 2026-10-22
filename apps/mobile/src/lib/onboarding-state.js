import { getJsonValue, setJsonValue } from "@paqueteria/core";

/**
 * Version del tutorial de bienvenida. Subirla vuelve a enseñarlo a quien ya lo
 * completo u omitio: solo debe hacerse cuando una version nueva traiga algo que
 * de verdad haya que contar.
 */
export const CLIENT_ONBOARDING_VERSION = 1;

const KEY = "client-onboarding";

/**
 * Clave de cada cuenta: organizacion y usuario. Dos personas en el mismo
 * telefono, o la misma persona en dos organizaciones, llevan progresos
 * distintos.
 */
export function onboardingScope(user) {
  if (!user?.id) return null;
  return (user.tenantId || user.tenant?.id || "no-tenant") + ":" + user.id;
}

/**
 * Si a este usuario le toca el tutorial: solo clientes, y solo si no ha
 * completado ni omitido la version actual.
 */
export function needsOnboarding(user, record, version = CLIENT_ONBOARDING_VERSION) {
  if (!user?.id || user.role !== "CLIENT") return false;
  if (!record) return true;
  return Number(record.version || 0) < version;
}

/**
 * Lo guardado de esta cuenta, o null. Solo el estado del tutorial: ni tokens
 * ni datos de la cuenta, aunque esto viva en AsyncStorage.
 */
export async function getOnboardingRecord(user) {
  const scope = onboardingScope(user);
  if (!scope) return null;

  try {
    const stored = await getJsonValue(KEY);
    return stored?.[scope] || null;
  } catch {
    // Si no se puede leer, mejor no enseñar el tutorial que bloquear la app.
    return { version: CLIENT_ONBOARDING_VERSION, status: "unknown" };
  }
}

/** Guarda que la cuenta completo ("completed") u omitio ("skipped") el tutorial. */
export async function saveOnboardingStatus(user, status, version = CLIENT_ONBOARDING_VERSION) {
  const scope = onboardingScope(user);
  if (!scope) return;

  try {
    const stored = (await getJsonValue(KEY)) || {};
    await setJsonValue(KEY, {
      ...stored,
      [scope]: { version, status, at: new Date().toISOString() },
    });
  } catch {
    // Sin poder guardarlo, el tutorial volveria a salir; no es motivo para
    // interrumpir al cliente con un error.
  }
}
