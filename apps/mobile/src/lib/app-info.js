import Constants from "expo-constants";

/**
 * Version instalada y fecha del build.
 *
 * La version sale de `app.config.js`, que es la que se publica; la fecha se
 * inyecta ahi al compilar. Ninguna de las dos esta escrita a mano en la
 * pantalla.
 */
export function getAppVersion() {
  return Constants.expoConfig?.version || null;
}

export function getBuildDate() {
  const raw = Constants.expoConfig?.extra?.buildDate;
  if (!raw) return null;

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "1.0.0 · Updated Aug 29, 2026" */
export function formatAppVersion() {
  const version = getAppVersion();
  const built = getBuildDate();

  if (!version) return "-";
  if (!built) return version;

  const when = built.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  return version + " · Updated " + when;
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
