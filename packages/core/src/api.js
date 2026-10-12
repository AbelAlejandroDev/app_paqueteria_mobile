import axios from "axios";
import { clearAuthUser, clearTokens, getTokens, setAuthUser, setTokens } from "./storage.js";
import { broadcastAuthUserUpdated, normalizeAuthUser } from "./auth.js";

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

export function createApiClient({ baseURL, onUnauthorized, headers = {} }) {
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

  const api = axios.create({ baseURL, headers });
  const refreshClient = axios.create({ baseURL, headers });

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

      const { refreshToken } = await getTokens();
      if (!refreshToken) {
        await abortSession();
        return Promise.reject(error);
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
        const response = await refreshClient.post("/auth/refresh", { refreshToken });
        const data = response.data || {};
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
        // Un 401 del refresh (SESSION_REVOKED incluido) no se reintenta: el
        // token no va a volver a valer.
        await abortSession(refreshError?.response?.data?.code || null);
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }
  );

  return api;
}
