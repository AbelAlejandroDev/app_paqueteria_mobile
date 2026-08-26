import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { CircleHelp, CreditCard, Home, Mail, Settings } from "lucide-react-native";
import { brand } from "@/lib/brand";

import { useAuth } from "@/context/AuthContext";

const ACTIVE_COLOR = brand.primaryColor;
const INACTIVE_COLOR = "#64748b";

/**
 * Equivalente de ClientLayout + ProtectedRoute allow={["CLIENT"]} del web.
 * Las tabs replican `mobileNavItems`, que el front web ya tenía definido para
 * su barra inferior en móvil.
 */
export default function ClientLayout() {
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

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: ACTIVE_COLOR,
        tabBarInactiveTintColor: INACTIVE_COLOR,
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="mail-items"
        options={{
          title: "Mail",
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Mail color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="billing"
        options={{
          title: "Billing",
          tabBarIcon: ({ color, size }) => <CreditCard color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => <Settings color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="help"
        options={{
          title: "Help",
          tabBarIcon: ({ color, size }) => <CircleHelp color={color} size={size} />,
        }}
      />

      {/* Rutas accesibles pero sin pestaña propia. */}
      <Tabs.Screen name="usps-verification" options={{ href: null, title: "USPS Verification" }} />
      <Tabs.Screen name="service-requests/new" options={{ href: null, title: "New Request" }} />
    </Tabs>
  );
}
