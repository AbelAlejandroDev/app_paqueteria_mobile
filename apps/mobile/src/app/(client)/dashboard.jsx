import { useMemo } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { Bell, CheckCircle2, ExternalLink, Inbox, MapPin, UsersRound } from "lucide-react-native";
import { brand } from "@/lib/brand";

import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { formatClientAddress, getClientName } from "@/lib/client-profile";
import { brandWordmarkOnLight } from "@/lib/brand-assets";
import { cn } from "@/lib/utils";
import EmptyState from "@/components/common/empty-state";

const CONFERENCE_ROOM_URL = "https://orlando.theworxoffices.com/conference-room/";

function AccessCard({ title, icon: Icon, onPress, tone = "default", notificationCount = 0, external = false }) {
  const badgeCount = Number(notificationCount || 0);

  return (
    <Pressable
      onPress={onPress}
      className="min-h-[76px] flex-row items-center justify-between rounded-lg border border-border bg-card px-4 py-3 active:bg-muted"
    >
      <View className="min-w-0 flex-1 flex-row items-center gap-4">
        <View className="relative">
          <View
            className={cn(
              "h-12 w-12 items-center justify-center rounded-md border",
              tone === "cyan" ? "border-cyan-200 bg-cyan-50" : "border-slate-200 bg-slate-100"
            )}
          >
            <Icon size={24} color={tone === "cyan" ? "#155e75" : "#334155"} />
          </View>
          {badgeCount > 0 ? (
            <View className="absolute -right-2 -top-2 h-6 min-w-[24px] items-center justify-center rounded-full border-2 border-card bg-rose-600 px-1">
              <Text className="text-xs font-semibold leading-none text-white">
                {badgeCount > 99 ? "99+" : badgeCount}
              </Text>
            </View>
          ) : null}
        </View>
        <Text className="flex-1 text-base font-semibold text-foreground">{title}</Text>
      </View>
      {external ? <ExternalLink size={16} color="#94a3b8" /> : null}
    </Pressable>
  );
}

export default function DashboardScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const query = useQuery({
    queryKey: ["client-mail-items"],
    queryFn: async () => {
      const response = await api.get("/client/mail-items");
      return response.data;
    },
  });

  const folders = useMemo(() => (Array.isArray(query.data?.folders) ? query.data.folders : []), [query.data]);
  const folderNotificationCount = (key) => Number(folders.find((folder) => folder.key === key)?.notificationCount || 0);

  const openFolder = (folder) => () => router.push({ pathname: "/mail-items", params: { folder } });

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-6 p-4 pb-24"
      // Sin barra de titulo no hay nada que aparte el contenido de la hora y
      // la bateria, asi que el margen superior lo pone la propia pantalla.
      contentContainerStyle={{ paddingTop: insets.top + 16 }}
      refreshControl={<RefreshControl refreshing={query.isFetching && !query.isLoading} onRefresh={query.refetch} />}
    >
      <View className="overflow-hidden rounded-lg border border-border bg-card">
        <View className="items-center gap-4 p-5">
          {/* El logotipo sustituye al rotulo "Client Dashboard": la app ya es
              de una sola marca, asi que la cabecera la identifica mejor. */}
          {brandWordmarkOnLight ? (
            <Image
              source={brandWordmarkOnLight}
              style={{ width: "70%", height: 56 }}
              contentFit="contain"
              accessibilityLabel={brand.name}
            />
          ) : (
            <Text className="text-xl font-semibold text-foreground">{brand.name}</Text>
          )}

          <View className="items-center gap-2">
            <Text className="text-center text-2xl font-semibold tracking-tight text-foreground">
              {getClientName(user)}
            </Text>
            {/* `flex-1` en el texto estiraba la fila a todo el ancho y dejaba
                el icono pegado al borde; con `shrink` el bloque se queda del
                tamaño del contenido y el centrado se nota. */}
            <View className="flex-row items-start justify-center gap-2">
              <MapPin size={16} color={brand.primaryColor} style={{ marginTop: 2 }} />
              <Text className="shrink text-sm leading-5 text-muted-foreground">{formatClientAddress(user)}</Text>
            </View>
          </View>
        </View>
      </View>

      {query.isError ? (
        <EmptyState title="Unable to load mailbox summary." description="Desliza hacia abajo para reintentar." />
      ) : null}

      <View className="gap-4">
        <AccessCard
          title="Inbox"
          icon={Inbox}
          onPress={openFolder("inbox")}
          notificationCount={folderNotificationCount("inbox")}
        />
        <AccessCard title="Action Required" icon={Bell} onPress={openFolder("action_required")} />
        <AccessCard title="Recent" icon={CheckCircle2} onPress={openFolder("completed")} />
        <AccessCard
          title="Conference Room"
          icon={UsersRound}
          tone="cyan"
          external
          onPress={() => WebBrowser.openBrowserAsync(CONFERENCE_ROOM_URL)}
        />
      </View>
    </ScrollView>
  );
}
