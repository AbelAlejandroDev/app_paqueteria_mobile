import { useState } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";

/**
 * Hay una sesion guardada pero no se pudo comprobar (sin red, timeout, 429,
 * 5xx o el servidor en mantenimiento) y no hay usuario guardado que enseñar.
 *
 * No se manda al login: las credenciales siguen guardadas y probablemente
 * valen. El cliente reintenta cuando vuelva la conexion.
 */
export default function SessionUnavailable({ onRetry }) {
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    setRetrying(true);
    try {
      await onRetry?.();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <View className="flex-1 items-center justify-center gap-4 bg-background px-6">
      <Text className="text-center font-brand-semibold text-lg text-foreground">We can&apos;t reach the server</Text>
      <Text className="text-center text-sm leading-5 text-muted-foreground">
        You are still signed in. Check your connection and try again in a moment.
      </Text>
      <Button loading={retrying} onPress={retry}>
        Try again
      </Button>
    </View>
  );
}
