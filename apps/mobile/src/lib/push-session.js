/**
 * Que hacer con el push cuando cambia la sesion (lo usa context/AuthContext).
 * Sin React ni expo, para probarlo.
 *
 *   - Habia usuario y se queda sin el SIN pasar por logout: la sesion la revoco
 *     el servidor (401, contraseña cambiada, cuenta cerrada) o era de otra
 *     organizacion. Ya no se puede llamar a `push-devices/unregister`, asi que
 *     el token se invalida en el dispositivo ("invalidate"). Si no, los avisos
 *     de esa cuenta seguirian llegando a la bandeja de este telefono.
 *   - Logout normal: ya dio de baja el dispositivo en el servidor ("none").
 *   - Sin red o un 5xx no quitan la sesion (classifySessionError), asi que no
 *     llegan aqui: nunca se invalida un token por un fallo temporal.
 *   - Arranque, login o el mismo usuario refrescado: "none".
 */
export function pushSessionLossAction({ previousUserId, nextUser, loggingOut }) {
  if (!previousUserId) return "none";
  if (nextUser) return "none";
  if (loggingOut) return "none";
  return "invalidate";
}
