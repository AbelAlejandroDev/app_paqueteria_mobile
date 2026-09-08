import { getJsonValue, setJsonValue } from "@paqueteria/core";

const KEY = "terms-passed-users";

/**
 * Quien ya paso la puerta de terminos en este dispositivo.
 *
 * Sirve para una sola decision: si la consulta de terminos falla por falta de
 * red, distinguir a quien entra por primera vez --al que hay que frenar-- de
 * quien ya acepto y solo esta abriendo la app otra vez, al que dejar fuera
 * seria un castigo por un problema de conexion.
 *
 * Se guarda por usuario y no como un booleano suelto porque en un mismo
 * telefono puede entrar otra persona: que el anterior aceptara no dice nada
 * del nuevo, y un unico valor le abriria la puerta sin haber aceptado.
 *
 * No es una autorizacion ni sustituye a la del servidor: mientras haya red,
 * quien manda es la respuesta de la API. Esto solo decide que hacer cuando no
 * hay respuesta.
 */
export async function hasPassedTerms(userId) {
  if (!userId) return false;

  const stored = await getJsonValue(KEY);
  return Boolean(stored?.[userId]);
}

export async function markTermsPassed(userId) {
  if (!userId) return;

  const stored = (await getJsonValue(KEY)) || {};
  if (stored[userId]) return;

  await setJsonValue(KEY, { ...stored, [userId]: true });
}
