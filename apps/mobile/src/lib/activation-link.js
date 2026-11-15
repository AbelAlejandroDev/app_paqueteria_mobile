/**
 * Token y correo de un enlace de activacion o de nueva contraseña. Sin React.
 *
 * El backend (src/config/portalUrls.buildSetPasswordUrl) los manda en el
 * FRAGMENTO por defecto, para que el token no llegue a ningun servidor ni log:
 *
 *   https://<portal-de-miembros>/set-password#token=<t>&email=<e>
 *
 * y en la query solo con SET_PASSWORD_LINK_STYLE=query (formato antiguo):
 *
 *   https://<portal-de-miembros>/set-password?token=<t>&email=<e>
 *
 * La app los recibe por Universal Link / App Link (cuando los portales
 * publiquen sus ficheros, docs/deep-links.md) o por su esquema propio
 * (worxclient://set-password?token=...&mode=reset). expo-router solo da los
 * parametros de la query; el fragmento se lee aqui de la URL completa.
 *
 * El token nunca se registra ni se guarda: solo viaja en el cuerpo de
 * POST /auth/set-password.
 */

/** El backend exige al menos 10 caracteres; se limita arriba por si acaso. */
const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{10,512}$/;

function cleanToken(value) {
  const token = typeof value === "string" ? value.trim() : "";
  return TOKEN_PATTERN.test(token) ? token : "";
}

function cleanEmail(value) {
  const email = typeof value === "string" ? value.trim() : "";
  return email.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(email) ? email : "";
}

function paramsFrom(part) {
  try {
    return new URLSearchParams(part);
  } catch {
    return new URLSearchParams();
  }
}

/** Separa query y fragmento sin depender de que el esquema sea https. */
function splitUrl(url) {
  const value = typeof url === "string" ? url : "";
  const hashIndex = value.indexOf("#");
  const beforeHash = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const hash = hashIndex >= 0 ? value.slice(hashIndex + 1) : "";
  const queryIndex = beforeHash.indexOf("?");
  const query = queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : "";
  const path = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  return { path, query, hash };
}

/** Si la URL es la de crear contraseña (/set-password), con cualquier esquema. */
export function isSetPasswordUrl(url) {
  const { path } = splitUrl(url);
  return /(^|\/)set-password\/?$/.test(path.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "/"));
}

/**
 * { token, email, mode } de los parametros de la ruta y de la URL completa.
 * El fragmento manda sobre la query (es el formato actual); los parametros de
 * expo-router, sobre la URL (vienen de la misma query ya decodificada).
 */
export function parseActivationLink({ url, params } = {}) {
  const { query, hash } = splitUrl(url);
  const fromHash = paramsFrom(hash);
  const fromQuery = paramsFrom(query);
  const routeToken = typeof params?.token === "string" ? params.token : "";
  const routeEmail = typeof params?.email === "string" ? params.email : "";

  const token = cleanToken(fromHash.get("token")) || cleanToken(routeToken) || cleanToken(fromQuery.get("token"));
  const email = cleanEmail(fromHash.get("email")) || cleanEmail(routeEmail) || cleanEmail(fromQuery.get("email"));
  const mode = params?.mode === "reset" || fromQuery.get("mode") === "reset" || fromHash.get("mode") === "reset" ? "reset" : "activate";

  return { token, email, mode };
}
