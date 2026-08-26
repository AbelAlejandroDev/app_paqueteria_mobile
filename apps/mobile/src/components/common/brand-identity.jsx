import { Text, View } from "react-native";
import { Image } from "expo-image";
import { Package2 } from "lucide-react-native";

import { brand, getBrandLogoUrl, getBrandName } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * Equivalente de BrandIdentity del front web. El logo llega del servidor
 * (user.branding.logoUrl); mientras no hay sesión se muestra el icono de
 * marcador con el nombre horneado en el build.
 */
export default function BrandIdentity({ branding, portalLabel, centered = false, className }) {
  const logoUrl = getBrandLogoUrl(branding);
  const brandName = getBrandName(branding);

  return (
    <View className={cn("flex-row items-center gap-3", centered && "flex-col", className)}>
      <View className="h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-primary">
        {logoUrl ? (
          <Image
            source={{ uri: logoUrl }}
            style={{ width: "100%", height: "100%" }}
            contentFit="contain"
            transition={150}
          />
        ) : (
          <Package2 size={22} color={brand.primaryForeground} />
        )}
      </View>

      <View className={cn("min-w-0", centered && "items-center")}>
        {portalLabel ? (
          <Text className="text-xs uppercase tracking-widest text-muted-foreground">{portalLabel}</Text>
        ) : null}
        <Text
          className={cn(
            "font-semibold text-foreground",
            centered ? "text-2xl tracking-tight" : "text-lg"
          )}
          numberOfLines={2}
        >
          {brandName}
        </Text>
      </View>
    </View>
  );
}
