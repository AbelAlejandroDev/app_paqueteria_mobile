/**
 * Emisor de eventos mínimo, sin dependencia de `window`.
 *
 * En la web esto lo hacía `window.dispatchEvent(new CustomEvent(...))`, que no
 * existe en React Native. Este emisor funciona igual en ambas plataformas.
 */

const listeners = new Map();

export function on(event, listener) {
  if (!listeners.has(event)) {
    listeners.set(event, new Set());
  }
  listeners.get(event).add(listener);

  return () => {
    listeners.get(event)?.delete(listener);
  };
}

export function emit(event, payload) {
  const handlers = listeners.get(event);
  if (!handlers) return;

  handlers.forEach((listener) => {
    try {
      listener(payload);
    } catch (error) {
      console.warn(`Listener de "${event}" lanzó un error`, error);
    }
  });
}
