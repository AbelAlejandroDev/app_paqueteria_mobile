/**
 * Almacenamiento agnóstico de plataforma.
 *
 * El front web usaba `localStorage`/`sessionStorage`, que son síncronos y no
 * existen en React Native. Aquí la API es asíncrona (funciona igual sobre un
 * backend síncrono, porque `await` acepta valores no-promesa) y cada app
 * inyecta su implementación en el arranque:
 *
 *   - móvil: `expo-secure-store` para tokens + `AsyncStorage` para el resto
 *   - web:   `localStorage`
 */

const ACCESS_TOKEN_KEY = "accessToken";
const REFRESH_TOKEN_KEY = "refreshToken";
const AUTH_USER_KEY = "authUser";

let backend = null;

/**
 * @param {object} nextBackend
 * @param {(key: string) => Promise<string|null>|string|null} nextBackend.getItem
 * @param {(key: string, value: string) => Promise<void>|void} nextBackend.setItem
 * @param {(key: string) => Promise<void>|void} nextBackend.removeItem
 * @param {object} [nextBackend.secure] - Opcional. Mismo contrato, para datos
 *   sensibles (tokens). Si no se pasa, se usa el backend normal.
 */
export function configureStorage(nextBackend) {
  if (!nextBackend?.getItem || !nextBackend?.setItem || !nextBackend?.removeItem) {
    throw new Error("configureStorage requiere getItem, setItem y removeItem.");
  }
  backend = nextBackend;
}

function requireBackend({ secure = false } = {}) {
  if (!backend) {
    throw new Error(
      "Storage sin configurar. Llama a configureStorage() antes de usar la API."
    );
  }
  return secure && backend.secure ? backend.secure : backend;
}

async function readJson(key, options) {
  const store = requireBackend(options);
  const rawValue = await store.getItem(key);

  if (!rawValue) return null;

  try {
    return JSON.parse(rawValue);
  } catch (error) {
    // Valor corrupto: lo descartamos en vez de arrastrar el error.
    await store.removeItem(key);
    return null;
  }
}

export async function getTokens() {
  const store = requireBackend({ secure: true });
  const [accessToken, refreshToken] = await Promise.all([
    store.getItem(ACCESS_TOKEN_KEY),
    store.getItem(REFRESH_TOKEN_KEY),
  ]);

  return { accessToken: accessToken || null, refreshToken: refreshToken || null };
}

export async function setTokens({ accessToken, refreshToken }) {
  const store = requireBackend({ secure: true });
  const writes = [];
  if (accessToken) writes.push(store.setItem(ACCESS_TOKEN_KEY, accessToken));
  if (refreshToken) writes.push(store.setItem(REFRESH_TOKEN_KEY, refreshToken));
  await Promise.all(writes);
}

export async function clearTokens() {
  const store = requireBackend({ secure: true });
  await Promise.all([
    store.removeItem(ACCESS_TOKEN_KEY),
    store.removeItem(REFRESH_TOKEN_KEY),
  ]);
}

export async function getAuthUser() {
  return readJson(AUTH_USER_KEY);
}

export async function setAuthUser(user) {
  const store = requireBackend();
  await store.setItem(AUTH_USER_KEY, JSON.stringify(user));
}

export async function clearAuthUser() {
  const store = requireBackend();
  await store.removeItem(AUTH_USER_KEY);
}

/** Lectura/escritura genérica para preferencias no sensibles. */
export async function getJsonValue(key) {
  return readJson(key);
}

export async function setJsonValue(key, value) {
  const store = requireBackend();
  await store.setItem(key, JSON.stringify(value));
}
