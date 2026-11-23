import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AUTH_USER_UPDATED_EVENT,
  broadcastAuthUserUpdated,
  clearAuthUser,
  clearTokens,
  formatErrorMessage,
  getAuthUser,
  getCurrentCenterId,
  getTokens,
  normalizeAuthUser,
  on,
  classifySessionError,
  SESSION_INVALID,
  setAuthUser,
  setTokens,
} from "@paqueteria/core";
import { api } from "@/lib/api";
import { brand } from "@/lib/brand";
import {
  addPushTokenChangeListener,
  dismissAllNotifications,
  invalidatePushOnSessionLoss,
  registerForPush,
  retryPendingPushUnregister,
  unregisterFromPush,
} from "@/lib/push-notifications";
import { pushSessionLossAction } from "@/lib/push-session";
import { setPushSessionActive } from "@/lib/push-presentation";
import { clearPrivateFilesOnDevice } from "@/lib/private-files-native";
import { clearBiometricLock } from "@/lib/security-preferences";
import { clearPendingNavigation } from "@/lib/pending-navigation";
import { createScopeTracker, resetQueryCache } from "@/lib/session-scope";
import { requestLogin } from "@/lib/login-flow";
import { isSessionForTenant, WRONG_ORGANIZATION, wrongOrganizationMessage } from "@/lib/session-tenant";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Hay tokens guardados pero no se pudo comprobar la sesion (sin red, 5xx...)
  // ni hay usuario guardado que enseñar. No es "sin sesion": no se va al login.
  const [sessionUnavailable, setSessionUnavailable] = useState(false);
  const queryClient = useQueryClient();
  // Quien tiene la sesion ahora y si la cierra el boton (logout ya da de baja el
  // push en el servidor) o se pierde por otra via (lib/push-session).
  const userIdRef = useRef(null);
  const loggingOutRef = useRef(false);

  /**
   * La cache es de quien entro. Se vacia ANTES de pintar al siguiente (no en un
   * efecto despues), para que ni un fotograma enseñe datos del anterior. Cuenta
   * tambien la organizacion: la misma persona en otro tenant no comparte cache.
   */
  const [trackScope] = useState(() =>
    createScopeTracker((nextScope) => {
      resetQueryCache(queryClient);
      // Un push tocado con la cuenta anterior no se abre en la siguiente.
      clearPendingNavigation();
      // PDFs de escaneos y fotos en disco: de la cuenta anterior (lib/private-files).
      clearPrivateFilesOnDevice();
      if (nextScope === null) {
        // Tambien si la sesion la cerro el servidor (revocada), no solo el boton.
        clearBiometricLock().catch(() => {});
      }
    })
  );

  /** Todo cambio de usuario pasa por aqui. */
  const applyUser = useCallback(
    (nextUser) => {
      // Sesion perdida sin logout (revocada, otra organizacion): el token push
      // se invalida en el dispositivo, porque ya no se puede dar de baja en el servidor.
      if (pushSessionLossAction({ previousUserId: userIdRef.current, nextUser, loggingOut: loggingOutRef.current }) === "invalidate") {
        invalidatePushOnSessionLoss().catch(() => {});
      }
      userIdRef.current = nextUser?.id ?? null;
      trackScope(nextUser);
      // Sin sesion no se enseñan avisos con la app delante (lib/push-presentation).
      setPushSessionActive(Boolean(nextUser));
      setUser(nextUser ?? null);
    },
    [trackScope]
  );

  /** Cierra la sesion local: tokens, usuario guardado y datos en memoria. */
  const endLocalSession = useCallback(async () => {
    await clearTokens();
    await clearAuthUser();
    broadcastAuthUserUpdated(null);
    setSessionUnavailable(false);
    applyUser(null);
    // Nada de esta cuenta queda en la bandeja del sistema.
    dismissAllNotifications();
  }, [applyUser]);

  const reload = useCallback(async () => {
    const { accessToken } = await getTokens();
    if (!accessToken) {
      // Sin sesion: si un logout sin red dejo el token vivo, se invalida ahora.
      retryPendingPushUnregister().catch(() => {});
      setSessionUnavailable(false);
      applyUser(null);
      setLoading(false);
      return null;
    }

    try {
      const response = await api.get("/auth/me");
      const nextUser = normalizeAuthUser(response.data?.user || response.data || null, response.data || {});

      // Una sesion de otra organizacion no vale en esta app (lib/session-tenant).
      if (nextUser && !isSessionForTenant(nextUser, brand.tenantSlug)) {
        await endLocalSession();
        return null;
      }

      setSessionUnavailable(false);
      applyUser(nextUser);

      if (nextUser) {
        await setAuthUser(nextUser);
        broadcastAuthUserUpdated(nextUser);
      } else {
        await clearAuthUser();
        broadcastAuthUserUpdated(null);
      }

      return nextUser;
    } catch (error) {
      // Solo una prueba del servidor de que las credenciales no valen (401, o
      // 404 "User not found") cierra la sesion. Sin red, timeout, 429, 5xx o un
      // 403 de permisos: los tokens se quedan y se sigue con el usuario guardado.
      if (classifySessionError(error) === SESSION_INVALID) {
        await endLocalSession();
        return null;
      }

      const cachedUser = await getAuthUser();
      if (cachedUser && !isSessionForTenant(cachedUser, brand.tenantSlug)) {
        await endLocalSession();
        return null;
      }
      if (cachedUser) {
        applyUser(cachedUser);
        setSessionUnavailable(false);
      } else {
        setSessionUnavailable(true);
      }
      return cachedUser || null;
    } finally {
      setLoading(false);
    }
  }, [applyUser, endLocalSession]);

  // Arranque: pintamos el usuario cacheado para evitar un splash largo y
  // revalidamos contra /auth/me en segundo plano.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const cachedUser = await getAuthUser();
      // Solo se pinta si es de esta organizacion; si no, reload la descarta.
      if (!cancelled && cachedUser && isSessionForTenant(cachedUser, brand.tenantSlug)) applyUser(cachedUser);
      await reload();
    })();

    return () => {
      cancelled = true;
    };
  }, [applyUser, reload]);

  const login = useCallback(
    async (email, password) => {
      try {
        // La organizacion de esta app (the_worx / hdg), fijada en la build. Sin
        // portal el backend la necesita para encontrar la cuenta (lib/login-flow).
        const result = await requestLogin(api, { email, password, tenantSlug: brand.tenantSlug });

        // El backend puede resolver otra organizacion si el correo solo existe
        // alli (tenantIdByUniqueEmail). Esa sesion no se guarda: ni tokens ni usuario.
        if (!result.ok) {
          return {
            ok: false,
            code: WRONG_ORGANIZATION,
            message: wrongOrganizationMessage(brand.shortName || brand.name),
            network: false,
            status: null,
          };
        }

        const data = result.data;
        await setTokens({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
        });

        const nextUser = normalizeAuthUser(data.user || null, data);
        if (nextUser) {
          setSessionUnavailable(false);
          applyUser(nextUser);
          await setAuthUser(nextUser);
          broadcastAuthUserUpdated(nextUser);
        }

        if (getCurrentCenterId(nextUser)) {
          return { ok: true };
        }

        await reload();
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          code: error?.response?.data?.error || "LOGIN_FAILED",
          message: formatErrorMessage(error, "Invalid credentials."),
          // Sin respuesta del servidor no son las credenciales: es la red (o
          // una VPN que no deja pasar). Se distingue para decirlo asi.
          network: !error?.response,
          status: error?.response?.status || null,
        };
      }
    },
    [applyUser, reload]
  );

  const logout = useCallback(async () => {
    loggingOutRef.current = true;
    try {
      // Antes de cerrar sesion, mientras el token todavia vale: si no, el
      // siguiente que entre en este telefono recibiria los avisos del anterior.
      await unregisterFromPush();
      // El bloqueo es del dispositivo: quien entre despues no lo ha activado.
      await clearBiometricLock();
      // Un push de esta cuenta no puede abrirse en la sesion de la siguiente.
      clearPendingNavigation();

      try {
        // Con el refresh en el cuerpo el backend revoca tambien esa sesion
        // (HDG 3a17a0e, controllers/auth/logout): su refresh deja de renovar
        // aunque el access fuera anterior a las sesiones con estado.
        const { refreshToken } = await getTokens();
        await api.post("/auth/logout", refreshToken ? { refreshToken } : {});
      } catch (error) {
        // Da igual si falla: la sesión local se limpia de todos modos.
      } finally {
        // Tokens, usuario guardado y cache de React Query.
        await endLocalSession();
      }
    } finally {
      loggingOutRef.current = false;
    }
  }, [endLocalSession]);

  /**
   * Registra el dispositivo en cuanto hay sesion, no solo al iniciarla.
   *
   * Asi tambien se cubre a quien ya venia con la sesion guardada, y se refresca
   * el token cuando el sistema lo rota. Si falla no se avisa: el cliente no ha
   * pedido nada aqui, y un error tapando la pantalla de inicio seria peor que
   * quedarse sin notificaciones.
   */
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return undefined;

    // Se registra el resultado aunque no se muestre: sin esto, un fallo al
    // obtener o guardar el token es invisible y solo se nota porque las
    // notificaciones no llegan, que es un sintoma muy lejano de la causa.
    // Nunca el token: solo el estado (lib/push-registration).
    const register = (force) =>
      registerForPush({ userId, force })
        .then(({ registered, status, reason, skipped }) => {
          if (skipped) return;
          if (registered) console.log("[push] dispositivo registrado" + (status === "registered-legacy" ? " (backend sin projectId)" : ""));
          else console.warn("[push] sin registrar:", reason);
        })
        .catch((error) => console.warn("[push] error inesperado:", error?.message || error));

    // Al haber sesion: login o arranque con la sesion guardada (renueva lastSeenAt
    // y reactiva un dispositivo que el backend hubiera desactivado).
    register(false);
    // Token nuevo de Expo/FCM/APNs con la app abierta: se registra el nuevo.
    return addPushTokenChangeListener(() => register(true));
  }, [userId]);

  useEffect(() => {
    // Lo emite tambien el cliente HTTP: tras un refresh (mismo usuario) y al
    // abortar una sesion revocada (null). Pasa por applyUser para que la cache
    // se vacie igual que en un cierre de sesion normal.
    return on(AUTH_USER_UPDATED_EVENT, (nextUser) => {
      if (!nextUser) setSessionUnavailable(false);
      applyUser(nextUser ?? null);
      setLoading(false);
    });
  }, [applyUser]);

  const value = useMemo(
    () => ({
      user,
      currentCenterId: getCurrentCenterId(user),
      loading,
      sessionUnavailable,
      login,
      logout,
      reload,
      isAuthenticated: !!user,
    }),
    [loading, login, logout, reload, sessionUnavailable, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
