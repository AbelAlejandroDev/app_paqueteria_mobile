/**
 * Cuando bloquear la app, sin React ni React Native.
 *
 * Reglas:
 * - Al abrir la app en frio, si el bloqueo esta activo, se bloquea.
 * - Al pasar de verdad a segundo plano se anota la hora.
 * - Si vuelve antes de 30 segundos, sigue sin pedir nada.
 * - Si vuelve a los 30 segundos o despues, se bloquea.
 *
 * El dialogo del sistema tambien cambia el estado de la app: en iOS la pasa a
 * "inactive" y en Android, con PIN o patron, puede llegar a "background". Si eso
 * contara como salir, cada autenticacion provocaria otro bloqueo al volver, y
 * ese otro bloqueo otra autenticacion. Mientras hay una autenticacion en curso,
 * los cambios de estado se ignoran.
 */

export const GRACE_PERIOD_MS = 30_000;

/** Solo "background" cuenta como salir: "inactive" es un tiron de notificaciones o el propio dialogo. */
export function shouldLockOnResume({ lastBackgroundAt, now }) {
  if (lastBackgroundAt == null) return false;
  return now - lastBackgroundAt >= GRACE_PERIOD_MS;
}

/** Cancelar mantiene la app bloqueada, igual que un fallo: solo el exito abre. */
export function stateAfterAuthentication(result) {
  return result?.success ? "unlocked" : "locked";
}

export function createLockController({ now = () => Date.now() } = {}) {
  let authenticating = false;
  let lastBackgroundAt = null;
  let appState = "active";

  return {
    get authenticating() {
      return authenticating;
    },
    get lastBackgroundAt() {
      return lastBackgroundAt;
    },

    /**
     * Un unico dialogo a la vez. Devuelve false si ya hay uno abierto: pedir un
     * segundo mientras el primero sigue en pantalla es lo que dispara el bucle.
     */
    beginAuthentication() {
      if (authenticating) return false;
      authenticating = true;
      return true;
    },

    endAuthentication(result) {
      authenticating = false;
      // Tras entrar, lo que paso antes ya no cuenta: sin esto, la vuelta a
      // "active" que sigue al dialogo leeria una salida vieja y volveria a
      // bloquear.
      if (result?.success) lastBackgroundAt = null;
    },

    /**
     * Procesa un cambio de AppState. Devuelve "lock" si hay que bloquear.
     *
     * Solo actua sobre transiciones reales: el mismo estado repetido no hace
     * nada, y nada de lo que ocurra durante una autenticacion cuenta.
     */
    onAppStateChange(nextState) {
      const previous = appState;
      appState = nextState;

      if (authenticating || previous === nextState) return "none";

      if (nextState === "background") {
        lastBackgroundAt = now();
        return "none";
      }

      // Se mira si hubo una salida anotada y no cual fue el estado anterior: en
      // iOS la vuelta puede pasar por "inactive" antes de "active", y exigir que
      // el anterior fuera "background" haria que esa vuelta nunca bloqueara.
      if (nextState === "active" && lastBackgroundAt != null) {
        const lock = shouldLockOnResume({ lastBackgroundAt, now: now() });
        lastBackgroundAt = null;
        return lock ? "lock" : "none";
      }

      return "none";
    },

    /** Al cerrar sesion: nada de esta sesion puede afectar a la siguiente. */
    reset() {
      authenticating = false;
      lastBackgroundAt = null;
      appState = "active";
    },
  };
}
