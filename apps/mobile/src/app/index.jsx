import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import SessionUnavailable from "@/components/common/session-unavailable";

/**
 * Equivalente de RoleRedirect del front web, pero esta app es solo para
 * clientes: staff y superadmin siguen usando el portal web.
 */
export default function Index() {
  const { user, loading, sessionUnavailable, reload } = useAuth();

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  // Sesion guardada que no se pudo comprobar (sin red, 5xx): no es un cierre
  // de sesion, asi que no se manda al login.
  if (!user && sessionUnavailable) {
    return <SessionUnavailable onRetry={reload} />;
  }

  if (!user) {
    return <Redirect href="/login" />;
  }

  if (user.role !== "CLIENT") {
    return <Redirect href="/unsupported-role" />;
  }

  return <Redirect href="/dashboard" />;
}
