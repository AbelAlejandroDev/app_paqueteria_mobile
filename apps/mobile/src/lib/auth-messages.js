/**
 * Mensajes y reglas de las pantallas sin sesion: entrar, recuperar la
 * contraseña y crear una nueva. Sin React, para poder probarlos.
 */

const NETWORK_MESSAGE =
  "We couldn't reach the server. Check your internet connection (or turn off your VPN) and try again.";

/** El error del login, dicho para el cliente. */
export function loginErrorMessage(result) {
  if (result?.network) return NETWORK_MESSAGE;
  if (result?.status === 429) return "Too many sign-in attempts. Please wait a few minutes and try again.";
  if (result?.status === 401 || result?.code === "Invalid credentials") {
    return "The email or password is incorrect. Please try again.";
  }
  return result?.message || "We couldn't sign you in. Please try again.";
}

/**
 * Que enseñar tras pedir el enlace de recuperacion.
 *
 * Exito y "no existe esa cuenta" se ven igual a proposito: decir cual de las
 * dos es le diria a cualquiera que correos tienen cuenta. El backend tiene que
 * responder lo mismo en ambos casos; la app tampoco distingue.
 *
 * Devuelve { kind: "sent" | "unavailable" | "error", message }.
 */
export function forgotPasswordOutcome(error) {
  if (!error) {
    return {
      kind: "sent",
      message:
        "If an account exists for that email, we've sent you a link to create a new password. Check your inbox and your spam folder.",
    };
  }

  if (!error.response) return { kind: "error", message: NETWORK_MESSAGE };

  const status = error.response.status;

  // El backend dice cuanto esperar (en el cuerpo y en Retry-After). Se usa
  // para el mensaje y para tener el boton apagado ese tiempo.
  if (status === 429) {
    const seconds = retryAfterSeconds(error.response);
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    return {
      kind: "error",
      retryAfter: seconds,
      message: seconds
        ? `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`
        : "Too many attempts. Please wait a few minutes before trying again.",
    };
  }

  // El backend aun no tiene el endpoint: no se finge que se envio nada.
  if (status === 404 || status === 405 || status === 501) {
    return {
      kind: "unavailable",
      message: "Password reset by email isn't available yet. Please contact your center and they'll help you reset it.",
    };
  }

  if (status === 400) return { kind: "error", message: "Enter a valid email address." };

  return { kind: "error", message: "Something went wrong. Please try again in a moment." };
}

/** Segundos de espera de un 429: `retryAfterSeconds` del cuerpo o la cabecera Retry-After. */
export function retryAfterSeconds(response) {
  const fromBody = Number(response?.data?.retryAfterSeconds);
  if (Number.isFinite(fromBody) && fromBody > 0) return Math.ceil(fromBody);

  const headers = response?.headers || {};
  const fromHeader = Number(headers["retry-after"] ?? headers["Retry-After"]);
  return Number.isFinite(fromHeader) && fromHeader > 0 ? Math.ceil(fromHeader) : 0;
}

/**
 * Por que la sesion termino sola, para explicarlo en el login.
 *
 * SESSION_REVOKED llega del refresh cuando el cliente cambio su contraseña (en
 * este telefono o en otro): todas sus sesiones anteriores dejan de valer.
 */
export function sessionEndedMessage(reason) {
  if (reason === "SESSION_REVOKED") {
    return "Your password was changed, so you were signed out on this device. Please sign in with your new password.";
  }
  return "";
}

/** Limites del backend: bcrypt solo usa los primeros 72 bytes. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;

/**
 * Lo que le falta a una contraseña nueva, o null si vale.
 *
 * Ademas del minimo del backend se pide una letra y un numero, y que no sea el
 * propio correo: son las que se adivinan primero.
 */
export function passwordProblem(password, email = "") {
  const value = String(password || "");
  if (value.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (value.length > PASSWORD_MAX) return `Use ${PASSWORD_MAX} characters or fewer.`;
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return "Include at least one letter and one number.";

  const local = String(email || "").split("@")[0].toLowerCase();
  if (local && local.length >= 4 && value.toLowerCase().includes(local)) {
    return "Don't use your email in your password.";
  }

  return null;
}
