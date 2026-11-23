import axios from "axios";
import { clearAuthUser, clearTokens, getTokens, setAuthUser, setTokens } from "./storage.js";
import { broadcastAuthUserUpdated, normalizeAuthUser } from "./auth.js";
import { isRefreshRejection } from "./session.js";
import { DEFAULT_TIMEOUT_MS, isHealthyResponse } from "./availability.js";

/**
 * Crea el cliente HTTP con refresh automático de token.
 *
 * Es el mismo flujo que `src/lib/api.js` en el front web, con dos cambios que
 * lo hacen portable:
 *
 *   1. Los interceptores son `async`, porque leer el token es asíncrono en
 *      React Native (axios soporta interceptores que devuelven promesa).
 *   2. El redirect a `/login` ya no es `window.location.assign`: se recibe como
 *      callback `onUnauthorized`, que cada app resuelve a su manera
 *      (`router.replace("/login")` en móvil, `window.location` en web).
 *
 * @param {object} options
 * @param {string} options.baseURL
 * @param {() => void} [options.onUnauthorized] - Se invoca cuando la sesión
 *   queda irrecuperable y hay que mandar al usuario al login.
 * @param {Record<string, string>} [options.headers]
 * @param {number} [options.timeout] - Milisegundos antes de dar una peticion
 *   por perdida (axios no tiene limite por defecto: una peticion colgada no
 *   terminaria nunca). Se puede alargar por peticion (`{ timeout }`), p. ej. en
 *   subidas de ficheros.
 * @param {Function} [options.adapter] - Adaptador de axios. Solo para tests:
 *   permite simular respuestas sin red.
 */
/**
 * Peticiones que se hacen sin sesion: entrar, renovar, crear o recuperar la
 * contraseña. Su 401 significa "credenciales incorrectas", no "sesion
 * caducada", asi que no se intenta renovar ni se cierra nada.
 *
 * Sin esto, una contraseña mal escrita en el login acababa en abortSession:
 * se volvia a cargar la pantalla de login y el mensaje de error se perdia.
 */
const PUBLIC_AUTH_PATHS = ["/auth/login", "/auth/refresh", "/auth/set-password", "/auth/forgot-password"];

export function isPublicAuthRequest(url) {
  const path = String(url || "")
    .split("?")[0]
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/^\/api\/v\d+/, "");
  const normalized = path.startsWith("/") ? path : "/" + path;
  return PUBLIC_AUTH_PATHS.includes(normalized);
}

/**
 * Un refresh sin respuesta (red, timeout) o con un 5xx no dice si el servidor
 * llego a rotar el token. Con rotacion y deteccion de reutilizacion (backend
 * HDG 3a17a0e, lib/authSessions), volver a presentar el refresh anterior pasados
 * 30 s (REFRESH_REUSE_GRACE_MS) revoca la sesion entera: por eso se repite UNA
 * vez enseguida, dentro de ese margen, donde el backend lo trata como "un
 * reintento" y devuelve el par vigente. Un 401/400 no se repite: es definitivo.
 */
export function isRetryableRefreshFailure(error) {
  const status = error?.response?.status;
  if (!error?.response) return true;
  return status >= 500 && status <= 599;
}

export const REFRESH_RETRY_DELAY_MS = 1000;

/** "Bearer abc" -> "abc"; lo que mando de verdad una peticion. */
function bearerOf(request) {
  const raw = request?.headers?.Authorization ?? request?.headers?.authorization;
  return typeof raw === "string" && raw.startsWith("Bearer ") ? raw.slice(7) : null;
}

export function createApiClient({ baseURL, onUnauthorized, headers = {}, adapter, timeout = DEFAULT_TIMEOUT_MS, refreshRetryDelayMs = REFRESH_RETRY_DELAY_MS }) {
  if (!baseURL) {
    throw new Error("createApiClient requiere baseURL.");
  }

  let isRefreshing = false;
  let pendingQueue = [];

  function processQueue(error, token) {
    pendingQueue.forEach(({ resolve, reject }) => {
      if (error) reject(error);
      else resolve(token);
    });
    pendingQueue = [];
  }

  /**
   * `reason` es el `code` del backend cuando lo hay (SESSION_REVOKED si el
   * cliente cambio su contraseña), para que la app pueda explicar por que
   * vuelve al login en vez de echarle sin decir nada.
   */
  async function abortSession(reason = null) {
    await clearTokens();
    await clearAuthUser();
    broadcastAuthUserUpdated(null);
    onUnauthorized?.(reason);
  }

  // Ningun reintento automatico aqui: solo se repite una peticion tras un 401
  // con refresh correcto (una vez, _retry), y eso es seguro porque el 401 lo da
  // authMiddleware antes de que el controlador haga nada. Un timeout o un 5xx
  // NO se repiten: un POST de pago podria haberse ejecutado ya.
  const config = { baseURL, headers, timeout, ...(adapter ? { adapter } : {}) };
  const api = axios.create(config);
  const refreshClient = axios.create(config);

  api.interceptors.request.use(async (config) => {
    const { accessToken } = await getTokens();
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  });

  api.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config;
      const status = error?.response?.status;

      if (status !== 401 || originalRequest?._retry || isPublicAuthRequest(originalRequest?.url)) {
        return Promise.reject(error);
      }

      const { accessToken: currentAccess, refreshToken } = await getTokens();
      if (!refreshToken) {
        await abortSession();
        return Promise.reject(error);
      }

      // La peticion salio con un access anterior y otro refresh ya trajo uno
      // nuevo mientras volaba: se repite con el vigente, sin rotar otra vez.
      const sentAccess = bearerOf(originalRequest);
      if (!isRefreshing && currentAccess && sentAccess && sentAccess !== currentAccess) {
        originalRequest._retry = true;
        originalRequest.headers.Authorization = `Bearer ${currentAccess}`;
        return api(originalRequest);
      }

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          pendingQueue.push({ resolve, reject });
        }).then((newAccessToken) => {
          originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        let response;
        try {
          response = await refreshClient.post("/auth/refresh", { refreshToken });
        } catch (firstError) {
          if (!isRetryableRefreshFailure(firstError)) throw firstError;
          // Una sola vez y con el MISMO refresh: dentro del margen del backend.
          await new Promise((resolve) => setTimeout(resolve, refreshRetryDelayMs));
          response = await refreshClient.post("/auth/refresh", { refreshToken });
        }
        const data = response.data || {};
        if (!data.accessToken) {
          // Sin access no hay sesion que repetir; el refresh guardado sigue.
          throw Object.assign(new Error("Refresh response without accessToken"), { response: null });
        }
        const nextUser = normalizeAuthUser(data.user || null, data);

        await setTokens({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken || refreshToken,
        });

        if (nextUser) {
          await setAuthUser(nextUser);
          broadcastAuthUserUpdated(nextUser);
        }

        processQueue(null, data.accessToken);
        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        // Solo un rechazo del servidor (401, SESSION_REVOKED incluido) cierra
        // la sesion: ese token no va a volver a valer. Sin red, un timeout, un
        // 429 o un 5xx no dicen nada del token; se conserva y la siguiente
        // peticion volvera a intentar el refresh.
        if (isRefreshRejection(refreshError)) {
          await abortSession(refreshError?.response?.data?.code || null);
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }
  );

  return api;
}

/**
 * Comprueba si la API responde, sin sesion y sin interceptores.
 *
 * GET /api/v1/health: sin sesion, sin base de datos ni terceros, y siempre el
 * mismo cuerpo `{"status":"ok"}` (backend 3bc5e88). Nunca manda el token: una
 * sonda no puede provocar un refresh ni cerrar nada.
 */
export const PROBE_PATH = "/health";

export function createApiProbe({ baseURL, timeout = DEFAULT_TIMEOUT_MS, adapter }) {
  if (!baseURL) throw new Error("createApiProbe requiere baseURL.");
  const client = axios.create({ baseURL, timeout, validateStatus: () => true, ...(adapter ? { adapter } : {}) });

  return async function probe() {
    try {
      return isHealthyResponse(await client.get(PROBE_PATH));
    } catch {
      return false;
    }
  };
}
