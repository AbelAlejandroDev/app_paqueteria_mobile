import Constants from "expo-constants";

/** La version instalada, tal como sale de `app.config.js`: "1.0.0". */
export function formatAppVersion() {
  return Constants.expoConfig?.version || "-";
}

/**
 * Zona horaria con su desfase actual: "America/New_York (UTC-04:00)".
 *
 * El desfase se toma de la fecha de hoy, no de una tabla fija, asi que sigue
 * al horario de verano: la misma zona da -04:00 en agosto y -05:00 en enero.
 */
export function formatTimeZone(now = new Date()) {
  let zone = null;

  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch (error) {
    zone = null;
  }

  // getTimezoneOffset devuelve minutos a restar, con el signo invertido.
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const minutes = String(absolute % 60).padStart(2, "0");
  const offset = "UTC" + sign + hours + ":" + minutes;

  return zone ? zone + " (" + offset + ")" : offset;
}
