import { Text, View } from "react-native";
import { Image } from "expo-image";
import { Package2 } from "lucide-react-native";

import { brand, getBrandLogoUrl, getBrandName } from "@/lib/brand";
import { brandMark } from "@/lib/brand-assets";
import { cn } from "@/lib/utils";

/**
 * Equivalente de BrandIdentity del front web.
 *
 * El distintivo usa el logo empaquetado con la marca, que está disponible
 * desde el primer arranque. Si el servidor manda un logo propio en
 * `user.branding.logoUrl` tiene prioridad, para que un cambio en el panel de
 * admin se refleje sin republicar la app.
 */
export default function BrandIdentity({ branding, portalLabel, centered = false, className }) {
  const remoteLogo = getBrandLogoUrl(branding);
  const brandName = getBrandName(branding);
  const source = remoteLogo ? { uri: remoteLogo } : brandMark;

  return (
    <View className={cn("flex-row items-center gap-3", centered && "flex-col", className)}>
      <View
        className="h-14 w-14 items-center justify-center overflow-hidden rounded-xl"
        style={{ backgroundColor: brand.markBackground }}
      >
        {source ? (
          <Image source={source} style={{ width: "100%", height: "100%" }} contentFit="contain" transition={150} />
        ) : (
          <Package2 size={24} color={brand.primaryForeground} />
        )}
      </View>

      <View className={cn("min-w-0", centered && "items-center")}>
        {portalLabel ? (
          <Text className="text-xs uppercase tracking-widest text-muted-foreground">{portalLabel}</Text>
        ) : null}
        <Text
          className={cn("font-semibold text-foreground", centered ? "text-2xl tracking-tight" : "text-lg")}
          numberOfLines={2}
        >
          {brandName}
        </Text>
      </View>
    </View>
  );
}
