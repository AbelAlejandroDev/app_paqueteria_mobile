export function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

/**
 * Textos tecnicos que no se le enseñan a nadie tal cual: los de validacion del
 * backend ("Invalid body", que sale en decenas de rutas) y los que pone axios
 * por defecto ("Network Error", "Request failed with status code 500").
 */
const TECHNICAL_MESSAGES = [
  /^invalid body$/i,
  /^validation (error|failed)$/i,
  /^bad request$/i,
  /^network error$/i,
  /^request failed with status code \d+$/i,
  /^timeout of \d+ms exceeded$/i,
  /^internal server error$/i,
];

const FRIENDLY = {
  network: "We couldn't reach the server. Check your internet connection and try again.",
  invalid: "Please check the information you entered and try again.",
  server: "Something went wrong on our side. Please try again in a moment.",
};

function isTechnical(message) {
  const text = String(message || "").trim();
  return !text || TECHNICAL_MESSAGES.some((pattern) => pattern.test(text));
}

/**
 * El error de una peticion, dicho para el cliente.
 *
 * Se usa el motivo del servidor cuando es legible ("Your scan request was
 * rejected: ..."); si es un texto tecnico se cambia por uno que se entienda,
 * segun el tipo de fallo.
 */
export function formatErrorMessage(error, fallback = "Something went wrong.") {
  const data = error?.response?.data || {};
  const status = error?.response?.status;

  const fromServer = [data.reason, data.message, data.error].find((value) => typeof value === "string" && value.trim());
  if (fromServer && !isTechnical(fromServer)) return fromServer;

  if (error && !error.response) return FRIENDLY.network;
  if (status === 400 || status === 422) return FRIENDLY.invalid;
  if (status >= 500) return FRIENDLY.server;

  if (error?.message && !isTechnical(error.message)) return error.message;
  return fallback;
}
