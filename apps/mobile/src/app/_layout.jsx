import "@/global.css";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider } from "@/context/AuthContext";
import PushIntentCapture from "@/components/common/push-intent-capture";
import { setupStorage } from "@/lib/storage";

// Conecta el storage nativo (SecureStore + AsyncStorage) al paquete core.
// Debe ejecutarse antes de la primera petición.
setupStorage();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
    },
  },
});

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Con las metricas iniciales el primer render ya trae los insets reales
          de la ventana. Sin ellas empieza en cero y se corrige un instante
          despues, que es cuando la barra de pestanas y las hojas pueden quedar
          debajo de la barra de navegacion del sistema. */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            {/* Fuera de todas las puertas: guarda el toque de un push aunque la app
                este cerrada, sin sesion o bloqueada. No navega. */}
            <PushIntentCapture />
            <Stack screenOptions={{ headerShown: false }} />
            <StatusBar style="dark" />
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
