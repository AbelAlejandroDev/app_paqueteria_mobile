import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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
import { registerForPush, unregisterFromPush } from "@/lib/push-notifications";
import { clearBiometricLock } from "@/lib/security-preferences";
import { clearPendingNavigation } from "@/lib/pending-navigation";
import { createScopeTracker, resetQueryCache } from "@/lib/session-scope";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Hay tokens guardados pero no se pudo comprobar la sesion (sin red, 5xx...)
  // ni hay usuario guardado que enseñar. No es "sin sesion": no se va al login.
  const [sessionUnavailable, setSessionUnavailable] = useState(false);
  const queryClient = useQueryClient();

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
      if (nextScope === null) {
        // Tambien si la sesion la cerro el servidor (revocada), no solo el boton.
        clearBiometricLock().catch(() => {});
      }
    })
  );

  /** Todo cambio de usuario pasa por aqui. */
  const applyUser = useCallback(
    (nextUser) => {
      trackScope(nextUser);
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
  }, [applyUser]);

  const reload = useCallback(async () => {
    const { accessToken } = await getTokens();
    if (!accessToken) {
      setSessionUnavailable(false);
      applyUser(null);
      setLoading(false);
      return null;
    }

    try {
      const response = await api.get("/auth/me");
      const nextUser = normalizeAuthUser(response.data?.user || response.data || null, response.data || {});
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
      if (!cancelled && cachedUser) applyUser(cachedUser);
      await reload();
    })();

    return () => {
      cancelled = true;
    };
  }, [applyUser, reload]);

  const login = useCallback(
    async (email, password) => {
      try {
        // La organizacion de esta app (the_worx / hdg). Sin ella el servidor la
        // deduce del dominio, y core.theworxoffices.com es de The Worx: un
        // cliente de HDG no podia entrar desde su propia app.
        const response = await api.post("/auth/login", { email, password, tenantSlug: brand.tenantSlug });
        const data = response.data || {};

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
    // Antes de cerrar sesion, mientras el token todavia vale: si no, el
    // siguiente que entre en este telefono recibiria los avisos del anterior.
    await unregisterFromPush();
    // El bloqueo es del dispositivo: quien entre despues no lo ha activado.
    await clearBiometricLock();
    // Un push de esta cuenta no puede abrirse en la sesion de la siguiente.
    clearPendingNavigation();

    try {
      await api.post("/auth/logout");
    } catch (error) {
      // Da igual si falla: la sesión local se limpia de todos modos.
    } finally {
      // Tokens, usuario guardado y cache de React Query.
      await endLocalSession();
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
  useEffect(() => {
    if (!user) return;

    // Se registra el resultado aunque no se muestre: sin esto, un fallo al
    // obtener o guardar el token es invisible y solo se nota porque las
    // notificaciones no llegan, que es un sintoma muy lejano de la causa.
    registerForPush()
      .then(({ token, reason }) => {
        if (token) console.log("[push] dispositivo registrado");
        else console.warn("[push] sin registrar:", reason);
      })
      .catch((error) => console.warn("[push] error inesperado:", error?.message || error));
  }, [user?.id]);

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
