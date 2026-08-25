import { Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";

/**
 * Staff y superadmin no tienen app móvil: sus pantallas viven solo en el
 * portal web. Sin esto, un login de staff dejaría la app en un estado roto.
 */
export default function UnsupportedRole() {
  const { user, logout } = useAuth();

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 items-center justify-center gap-4 px-8">
        <Text className="text-center text-xl font-semibold text-foreground">
          Esta app es solo para clientes
        </Text>
        <Text className="text-center text-base leading-6 text-muted-foreground">
          Tu cuenta tiene el rol {user?.role || "STAFF"}. Las herramientas de personal y
          administración están disponibles en el portal web.
        </Text>
        <TouchableOpacity
          className="mt-4 h-12 w-full items-center justify-center rounded-lg bg-primary"
          onPress={logout}
        >
          <Text className="text-base font-semibold text-primary-foreground">
            Cerrar sesión
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
