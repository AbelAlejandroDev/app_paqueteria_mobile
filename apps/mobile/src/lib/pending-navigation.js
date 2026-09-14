/**
 * Navegacion pendiente que llega de un push.
 *
 * Un push puede tocarse con la app cerrada, sin sesion, con los terminos sin
 * aceptar o con el bloqueo puesto. En ninguno de esos casos se puede navegar
 * todavia: se guarda la intencion aqui y la consume quien esta detras de todas
 * las puertas, cuando las tres dejan pasar.
 *
 * Es un modulo sin React ni React Native a proposito: la regla de cuando se
 * navega vive aqui, se puede probar, y los componentes solo la conectan.
 */

let pending = null;
// Claves ya navegadas en esta sesion. Un mismo toque llega por dos vias al abrir
// desde cerrada --el listener y la ultima respuesta guardada--, y solo debe
// abrir una pantalla.
const consumed = new Set();
const listeners = new Set();

function notify() {
  for (const listener of listeners) listener();
}

/** Guarda la intencion. Si ya se navego por esta clave, se ignora. */
export function setPendingNavigation({ route, key }) {
  if (!route) return false;
  if (key && consumed.has(key)) return false;
  if (key && pending?.key === key) return false;

  pending = { route, key: key || null };
  notify();
  return true;
}

export function peekPendingNavigation() {
  return pending;
}

/** Todas las puertas que un push no puede saltarse. */
export function gatesOpen(gates) {
  return Boolean(gates?.authenticated && gates?.termsAccepted && gates?.unlocked);
}

/**
 * Navega si hay algo pendiente y todas las puertas estan abiertas.
 *
 * Devuelve true si navego. Si alguna puerta sigue cerrada, la intencion se
 * conserva intacta para el siguiente intento.
 */
export function consumePendingNavigation({ gates, navigate }) {
  if (!pending || !gatesOpen(gates)) return false;

  const { route, key } = pending;
  pending = null;
  if (key) consumed.add(key);

  navigate(route);
  return true;
}

/**
 * Al cerrar sesion.
 *
 * Una notificacion de la cuenta anterior no puede abrirse en la siguiente, y las
 * claves consumidas tampoco deben impedir que el nuevo usuario abra las suyas.
 */
export function clearPendingNavigation() {
  pending = null;
  consumed.clear();
  notify();
}

export function subscribePendingNavigation(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
