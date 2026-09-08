import { ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import { WifiOff } from "lucide-react-native";

import { brand } from "@/lib/brand";
import { brandWordmarkOnLight } from "@/lib/brand-assets";
import { Button } from "@/components/ui/button";

/**
 * Pantalla de "no hay conexion", con la marca puesta.
 *
 * Se separa del sitio que la usa para poder reutilizarla: cualquier pantalla
 * que no pueda seguir sin red debe verse igual, y no como un error suelto.
 *
 * Lleva siempre reintento, que es lo unico que el cliente puede hacer aqui:
 * una pantalla de error sin salida obliga a cerrar la app para volver a
 * intentarlo.
 */
export default function ConnectionError({
  title = "No internet connection",
  description = "We could not reach our servers. Check your connection and try again.",
  onRetry,
  retrying = false,
  retryLabel = "Try again",
}) {
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="flex-grow items-center justify-center gap-6 p-8"
    >
      {brandWordmarkOnLight ? (
        <Image
          source={brandWordmarkOnLight}
          style={{ width: "70%", height: 48 }}
          contentFit="contain"
          accessibilityLabel={brand.name}
        />
      ) : (
        <Text className="text-xl font-semibold text-foreground">{brand.name}</Text>
      )}

      <View className="h-16 w-16 items-center justify-center rounded-full bg-muted">
        <WifiOff size={30} color="#64748b" />
      </View>

      <View className="gap-2">
        <Text className="text-center text-xl font-semibold text-foreground">{title}</Text>
        <Text className="text-center text-sm leading-6 text-muted-foreground">{description}</Text>
      </View>

      {onRetry ? (
        <Button className="w-full" loading={retrying} onPress={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </ScrollView>
  );
}
