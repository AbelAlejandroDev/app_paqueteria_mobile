import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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
  setAuthUser,
  setTokens,
} from "@paqueteria/core";
import { api } from "@/lib/api";
import { registerForPush, unregisterFromPush } from "@/lib/push-notifications";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const { accessToken } = await getTokens();
    if (!accessToken) {
      setUser(null);
      setLoading(false);
      return null;
    }

    try {
      const response = await api.get("/auth/me");
      const nextUser = normalizeAuthUser(response.data?.user || response.data || null, response.data || {});
      setUser(nextUser);

      if (nextUser) {
        await setAuthUser(nextUser);
        broadcastAuthUserUpdated(nextUser);
      } else {
        await clearAuthUser();
        broadcastAuthUserUpdated(null);
      }

      return nextUser;
    } catch (error) {
      await clearTokens();
      await clearAuthUser();
      broadcastAuthUserUpdated(null);
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Arranque: pintamos el usuario cacheado para evitar un splash largo y
  // revalidamos contra /auth/me en segundo plano.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const cachedUser = await getAuthUser();
      if (!cancelled && cachedUser) setUser(cachedUser);
      await reload();
    })();

    return () => {
      cancelled = true;
    };
  }, [reload]);

  const login = useCallback(
    async (email, password) => {
      try {
        const response = await api.post("/auth/login", { email, password });
        const data = response.data || {};

        await setTokens({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
        });

        const nextUser = normalizeAuthUser(data.user || null, data);
        if (nextUser) {
          setUser(nextUser);
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
        };
      }
    },
    [reload]
  );

  const logout = useCallback(async () => {
    // Antes de cerrar sesion, mientras el token todavia vale: si no, el
    // siguiente que entre en este telefono recibiria los avisos del anterior.
    await unregisterFromPush();

    try {
      await api.post("/auth/logout");
    } catch (error) {
      // Da igual si falla: la sesión local se limpia de todos modos.
    } finally {
      await clearTokens();
      await clearAuthUser();
      broadcastAuthUserUpdated(null);
      setUser(null);
    }
  }, []);

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

    registerForPush().catch(() => {});
  }, [user?.id]);

  useEffect(() => {
    return on(AUTH_USER_UPDATED_EVENT, (nextUser) => {
      setUser(nextUser ?? null);
      setLoading(false);
    });
  }, []);

  const value = useMemo(
    () => ({
      user,
      currentCenterId: getCurrentCenterId(user),
      loading,
      login,
      logout,
      reload,
      isAuthenticated: !!user,
    }),
    [loading, login, logout, reload, user]
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
