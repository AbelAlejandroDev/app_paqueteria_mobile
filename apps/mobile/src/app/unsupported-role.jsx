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
          This app is for clients only
        </Text>
        <Text className="text-center text-base leading-6 text-muted-foreground">
          Your account has the {user?.role || "STAFF"} role. Staff and administration tools are
          available in the web portal.
        </Text>
        <TouchableOpacity
          className="mt-4 h-12 w-full items-center justify-center rounded-lg bg-primary"
          onPress={logout}
        >
          <Text className="text-base font-semibold text-primary-foreground">
            Sign out
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
