import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Modal, Text, View } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Lock } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { brand } from "@/lib/brand";
import { brandWordmarkOnLight } from "@/lib/brand-assets";
import { useAuth } from "@/context/AuthContext";
import { createLockController, stateAfterAuthentication } from "@/lib/biometric-lock-policy";
import {
  authenticate,
  describeAuthenticationError,
  getSecurityPreferences,
} from "@/lib/security-preferences";
import { Button } from "@/components/ui/button";

const BiometricLockContext = createContext({ locked: false });

/** Si la app esta bloqueada. Quien navega por un push espera a que no lo este. */
export function useBiometricLock() {
  return useContext(BiometricLockContext);
}

function LockScreen({ onUnlock, unlocking, message, onSignOut }) {
  // Va a pantalla completa, sin cabecera ni pestanas que reserven los bordes.
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-1 items-center justify-center gap-6 bg-background px-8"
      style={{ paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 }}
    >
      {brandWordmarkOnLight ? (
        <Image
          source={brandWordmarkOnLight}
          style={{ width: "70%", height: 48 }}
          contentFit="contain"
          accessibilityLabel={brand.name}
        />
      ) : null}

      <View className="h-16 w-16 items-center justify-center rounded-full bg-muted">
        <Lock size={28} color="#64748b" />
      </View>

      <View className="gap-2">
        <Text className="text-center text-xl font-semibold text-foreground">App locked</Text>
        <Text className="text-center text-sm leading-6 text-muted-foreground">
          {message || "Unlock to open your mailbox."}
        </Text>
      </View>

      <View className="w-full gap-3">
        <Button loading={unlocking} onPress={onUnlock}>
          Unlock
        </Button>
        {/* Sin salida, quien no puede autenticarse tendria que desinstalar la
            app para volver a entrar con su contrasena. */}
        <Button variant="outline" disabled={unlocking} onPress={onSignOut}>
          Sign out
        </Button>
      </View>
    </View>
  );
}

/**
 * Bloqueo de la app.
 *
 * - Al abrir en frio con el bloqueo activo, no se monta nada de la app hasta
 *   entrar: no hay un instante en que se vea el buzon.
 * - Al volver de segundo plano pasados 30 segundos, se tapa la app con la misma
 *   pantalla. Se tapa en vez de desmontarla para no perder donde estaba el
 *   cliente, y se hace con un Modal para quedar tambien por encima de cualquier
 *   hoja que estuviera abierta.
 *
 * La regla de cuando bloquear vive en biometric-lock-policy, sin React, para
 * poder probarla; aqui solo se conecta con AppState.
 */
export default function BiometricGate({ children }) {
  const { logout } = useAuth();
  // Un unico controlador por montaje. useState perezoso y no un ref: el
  // compilador de React no admite leer refs durante el render.
  const [controller] = useState(createLockController);

  // "checking" -> "locked" | "unlocked". Nunca se empieza desbloqueado.
  const [state, setState] = useState("checking");
  const [unlockedOnce, setUnlockedOnce] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [message, setMessage] = useState("");
  // Si el bloqueo esta activo. Se lee al abrir y cada vez que la app sale, asi
  // que al volver la decision es inmediata: esperar a leerlo dejaria ver la app
  // un instante antes de taparla.
  const lockEnabled = useRef(false);

  const unlock = useCallback(async () => {
    // Un unico dialogo a la vez. Pedir otro con el primero abierto es lo que
    // dispara el bucle dialogo -> cambio de estado -> otro dialogo.
    if (!controller.beginAuthentication()) return;

    setUnlocking(true);
    setMessage("");

    const result = await authenticate("Unlock your mailbox");
    controller.endAuthentication(result);
    setUnlocking(false);

    if (stateAfterAuthentication(result) === "unlocked") {
      setState("unlocked");
      setUnlockedOnce(true);
      return;
    }

    // Cancelar no es un error: la app sigue bloqueada, sin reprocharle nada.
    setMessage(result.cancelled ? "" : describeAuthenticationError(result.error));
  }, [controller]);

  // Apertura en frio.
  useEffect(() => {
    let active = true;

    getSecurityPreferences().then((prefs) => {
      if (!active) return;
      lockEnabled.current = Boolean(prefs.requireBiometrics);

      if (!lockEnabled.current) {
        setState("unlocked");
        setUnlockedOnce(true);
        return;
      }

      setState("locked");
      unlock();
    });

    return () => {
      active = false;
    };
  }, [unlock]);

  // Vuelta desde segundo plano.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background") {
        // Se relee aqui porque el cliente pudo activarlo o quitarlo en Settings.
        // La app ya no esta a la vista, asi que esperar a leerlo no enseña nada.
        getSecurityPreferences().then((prefs) => {
          lockEnabled.current = Boolean(prefs.requireBiometrics);
        });
      }

      if (controller.onAppStateChange(nextState) !== "lock") return;
      if (!lockEnabled.current) return;

      setState("locked");
      unlock();
    });

    return () => subscription.remove();
  }, [controller, unlock]);

  const signOut = async () => {
    controller.reset();
    await logout();
    router.replace("/login");
  };

  const lockScreen = (
    <LockScreen onUnlock={unlock} unlocking={unlocking} message={message} onSignOut={signOut} />
  );

  if (state === "checking") {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={brand.primaryColor} />
      </View>
    );
  }

  // Todavia no se ha entrado nunca en esta sesion: no hay app que conservar.
  if (state === "locked" && !unlockedOnce) return lockScreen;

  const locked = state === "locked";

  return (
    <BiometricLockContext.Provider value={{ locked }}>
      {children}
      <Modal
        visible={locked}
        animationType="none"
        statusBarTranslucent
        navigationBarTranslucent
        // El boton atras de Android no puede quitar el bloqueo.
        onRequestClose={() => {}}
      >
        {lockScreen}
      </Modal>
    </BiometricLockContext.Provider>
  );
}
