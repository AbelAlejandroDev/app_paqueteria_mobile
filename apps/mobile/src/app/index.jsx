import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { useAuth } from "@/context/AuthContext";

/**
 * Equivalente de RoleRedirect del front web, pero esta app es solo para
 * clientes: staff y superadmin siguen usando el portal web.
 */
export default function Index() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/login" />;
  }

  if (user.role !== "CLIENT") {
    return <Redirect href="/unsupported-role" />;
  }

  return <Redirect href="/dashboard" />;
}
