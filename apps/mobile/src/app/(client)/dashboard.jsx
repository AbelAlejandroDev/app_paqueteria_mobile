import { useMemo } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Bell, CheckCircle2, ChevronRight, ExternalLink, Inbox, MapPin, UsersRound } from "lucide-react-native";
import { brand } from "@/lib/brand";

import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { formatCenterAddress, getCenterLabel, getClientName, getMailboxCode } from "@/lib/client-profile";
import { brandHomeHero, brandWordmarkOnLight } from "@/lib/brand-assets";
import { cn } from "@/lib/utils";
import EmptyState from "@/components/common/empty-state";
import { DetailCard } from "@/components/common/mail-item-detail-ui";
import AccountAlerts from "@/components/common/account-alerts";

const CONFERENCE_ROOM_URL = "https://orlando.theworxoffices.com/conference-room/";

/** Verde oscuro de la tarjeta de bienvenida, de izquierda a derecha. */
const HERO_FROM = "#0F3A33";
const HERO_TO = "#2F6F62";

/** Tonos de "Action Required" cuando hay algo pendiente. */
const ATTENTION = { icon: "#D97706" };

function AccessCard({ title, icon: Icon, onPress, notificationCount = 0, external = false, attention = false }) {
  const badgeCount = Number(notificationCount || 0);

  return (
    <DetailCard tone={attention ? "amber" : "default"}>
      <Pressable
        onPress={onPress}
        className={cn(
          "min-h-[76px] flex-row items-center justify-between px-4 py-3",
          attention ? "active:bg-amber-100/60" : "active:bg-tint/20"
        )}
      >
        <View className="min-w-0 flex-1 flex-row items-center gap-4">
          <View className="relative">
            <View
              className={cn(
                "h-12 w-12 items-center justify-center rounded-[10px] border",
                attention ? "border-amber-200 bg-amber-100" : "border-primary/40 bg-tint/35"
              )}
            >
              <Icon size={23} color={attention ? ATTENTION.icon : brand.palette.glyph} />
            </View>
            {badgeCount > 0 ? (
              <View className="absolute -right-2 -top-2 h-6 min-w-[24px] items-center justify-center rounded-full border-2 border-white bg-rose-600 px-1">
                <Text className="font-hanken-bold text-[12px] leading-none text-white">
                  {badgeCount > 99 ? "99+" : badgeCount}
                </Text>
              </View>
            ) : null}
          </View>
          <Text className="flex-1 font-hanken-bold text-[16px] text-ink">{title}</Text>
        </View>
        {external ? (
          <ExternalLink size={17} color={brand.palette.ink} />
        ) : (
          <ChevronRight size={20} color={brand.palette.ink} />
        )}
      </Pressable>
    </DetailCard>
  );
}

/** Logo con el centro debajo, a la izquierda, y la campana de avisos a la derecha. */
function HomeHeader({ centerLabel, hasUnread }) {
  return (
    <View className="flex-row items-center justify-between gap-4">
      <View className="min-w-0 flex-1 items-start">
        {brandWordmarkOnLight ? (
          <Image
            source={brandWordmarkOnLight}
            style={{ width: 210, height: 34 }}
            contentFit="contain"
            contentPosition="left"
            accessibilityLabel={brand.name}
          />
        ) : (
          <Text className="font-hanken-bold text-[22px] text-ink">{brand.name}</Text>
        )}

        {/* Como el logo -mayusculas, negrita, muy espaciado y casi negro- para
            que se lea como parte de el y no como un subtitulo. */}
        {centerLabel ? (
          <Text
            className="mt-1.5 font-hanken-bold text-[16px] uppercase text-[#141414]"
            style={{ letterSpacing: 4 }}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
          >
            {centerLabel}
          </Text>
        ) : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={hasUnread ? "Notifications, unread" : "Notifications"}
        onPress={() => router.push("/notifications")}
        className="h-14 w-14 items-center justify-center rounded-full bg-white active:opacity-80"
        style={{
          shadowColor: "#1D4E4A",
          shadowOpacity: 0.1,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 4,
        }}
      >
        <Bell size={24} color={brand.palette.ink} />
        {hasUnread ? (
          <View className="absolute right-3 top-3 h-3 w-3 rounded-full border-2 border-white bg-rose-600" />
        ) : null}
      </Pressable>
    </View>
  );
}

/**
 * Tarjeta de bienvenida: nombre del cliente, donde esta su buzon y el numero.
 *
 * El fondo es un degradado verde dibujado con SVG (ya viene con lucide, no
 * añade nada nativo). Si la marca trae foto del edificio se pone encima, con
 * el degradado por delante para que el texto blanco se siga leyendo.
 */
function WelcomeCard({ clientName, location, mailboxCode }) {
  return (
    <View
      className="overflow-hidden rounded-2xl"
      style={{
        backgroundColor: HERO_FROM,
        shadowColor: "#0F3A33",
        shadowOpacity: 0.18,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 6 },
        elevation: 4,
      }}
    >
      {brandHomeHero ? (
        <Image
          source={brandHomeHero}
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
          contentFit="cover"
          contentPosition="right"
        />
      ) : null}

      <Svg style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} width="100%" height="100%">
        <Defs>
          <LinearGradient id="welcome" x1="0" y1="0" x2="1" y2="0.35">
            <Stop offset="0" stopColor={HERO_FROM} stopOpacity="1" />
            <Stop offset="0.55" stopColor={HERO_FROM} stopOpacity={brandHomeHero ? "0.88" : "1"} />
            <Stop offset="1" stopColor={HERO_TO} stopOpacity={brandHomeHero ? "0.35" : "1"} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#welcome)" />
      </Svg>

      <View className="flex-row items-end gap-3 px-5 py-6">
        <View className="min-w-0 flex-1 gap-1.5">
          <Text className="font-hanken text-[16px] text-white/85">Welcome back</Text>
          <Text
            className="font-hanken-bold text-[28px] leading-[34px] tracking-tight text-white"
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {clientName}
          </Text>
          {location ? (
            <View className="mt-1 flex-row items-start gap-1.5">
              <MapPin size={17} color="#ffffff" style={{ marginTop: 2 }} />
              <Text className="shrink font-hanken text-[15px] leading-5 text-white/90" numberOfLines={2}>
                {location}
              </Text>
            </View>
          ) : null}
        </View>

        {mailboxCode ? (
          <View className="items-center rounded-2xl border border-white/25 bg-white/15 px-4 py-3">
            <Text className="font-hanken text-[13px] text-white/85">Mailbox</Text>
            <Text className="font-hanken-bold text-[22px] text-white">{mailboxCode}</Text>
          </View>
        ) : null}
      </View>
    </View>
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

  // Solo hace falta saber si hay alguno sin leer, para el punto de la
  // campana. La clave empieza por "client-notifications" para que se refresque
  // con las invalidaciones que ya hacen la lista y el detalle al marcar leido.
  const unreadQuery = useQuery({
    queryKey: ["client-notifications", "unread-dot"],
    queryFn: async () => {
      const response = await api.get("/client/notifications", { params: { unreadOnly: true, take: 1 } });
      return Array.isArray(response.data?.items) ? response.data.items.length > 0 : false;
    },
    staleTime: 60_000,
  });

  const folders = useMemo(() => (Array.isArray(query.data?.folders) ? query.data.folders : []), [query.data]);
  const folderOf = (key) => folders.find((folder) => folder.key === key) || {};
  const actionRequiredCount = Number(folderOf("action_required").count || 0);

  const openFolder = (folder) => () => router.push({ pathname: "/mail-items", params: { folder } });
  // Inbox lleva a Mail, donde estan las cuatro carpetas (Inbox, Pending,
  // Action Required, Completed). Los parametros vacios hacen falta: la pestaña
  // Mail recuerda la ultima carpeta abierta y sin ellos volveria a esa.
  const openMail = () => router.push({ pathname: "/mail-items", params: { folder: "", filter: "" } });

  const refresh = () => Promise.all([query.refetch(), unreadQuery.refetch()]);

  return (
    <ScrollView
      className="flex-1 bg-canvas"
      contentContainerClassName="gap-5 p-4 pb-24"
      // Sin barra de titulo no hay nada que aparte el contenido de la hora y
      // la bateria, asi que el margen superior lo pone la propia pantalla.
      contentContainerStyle={{ paddingTop: insets.top + 16 }}
      refreshControl={<RefreshControl refreshing={query.isFetching && !query.isLoading} onRefresh={refresh} />}
    >
      <HomeHeader centerLabel={getCenterLabel(user)} hasUnread={Boolean(unreadQuery.data)} />

      <WelcomeCard
        clientName={getClientName(user)}
        location={formatCenterAddress(user)}
        mailboxCode={getMailboxCode(user)}
      />

      <AccountAlerts />

      {query.isError ? (
        <EmptyState title="Unable to load mailbox summary." description="Pull down to try again." />
      ) : null}

      <View className="gap-3">
        <AccessCard
          title="Inbox"
          icon={Inbox}
          onPress={openMail}
          notificationCount={Number(folderOf("inbox").notificationCount || 0)}
        />
        {/* En amarillo y con el numero cuando hay piezas esperando algo del
            cliente; sin nada pendiente, igual que las demas. */}
        <AccessCard
          title="Action Required"
          icon={Bell}
          attention={actionRequiredCount > 0}
          notificationCount={actionRequiredCount}
          onPress={openFolder("action_required")}
        />
        <AccessCard title="Recent" icon={CheckCircle2} onPress={openFolder("completed")} />
        <AccessCard
          title="Conference Room"
          icon={UsersRound}
          external
          onPress={() => WebBrowser.openBrowserAsync(CONFERENCE_ROOM_URL)}
        />
      </View>
    </ScrollView>
  );
}
