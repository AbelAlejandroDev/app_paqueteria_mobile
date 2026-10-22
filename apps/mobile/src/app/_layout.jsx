import "@/global.css";

import { useEffect } from "react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider } from "@/context/AuthContext";
import PushIntentCapture from "@/components/common/push-intent-capture";
import { setupStorage } from "@/lib/storage";
import { brandFontFiles } from "@/lib/brand-fonts";

// Conecta el storage nativo (SecureStore + AsyncStorage) al paquete core.
// Debe ejecutarse antes de la primera petición.
setupStorage();

// La pantalla de carga se queda hasta tener la tipografia de la marca.
SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
    },
  },
});

export default function RootLayout() {
  // Se espera a la tipografia antes de pintar: Android mide el texto con la
  // fuente que haya y no lo vuelve a medir al llegar la de la marca. Con una
  // mas ancha que la del sistema (Poppins, en HDG) el texto salia cortado:
  // "Sign" en vez de "Sign in". Va empaquetada, asi que la espera es minima;
  // si fallara, se sigue con la del sistema antes que bloquear la app.
  const [fontsLoaded, fontsError] = useFonts(brandFontFiles);
  const fontsReady = fontsLoaded || Boolean(fontsError);

  useEffect(() => {
    if (fontsReady) SplashScreen.hideAsync().catch(() => {});
  }, [fontsReady]);

  if (!fontsReady) return null;

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
