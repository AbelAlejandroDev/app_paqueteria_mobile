import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight } from "lucide-react-native";

import { api } from "@/lib/api";
import { brand } from "@/lib/brand";
import { overWhite } from "@/lib/colors";
import { cn, formatErrorMessage } from "@/lib/utils";
import { formatEventTime } from "@/lib/mail-item-detail";
import { NOTIFICATIONS_QUERY_KEY, isItemActionNotification, routeForNotification } from "@/lib/notification-routing";
import { isUpdateNotification } from "@/lib/notification-kind";
import {
  isMailReceived,
  notificationDisplay,
  routeForMailReceived,
  stackMailNotifications,
} from "@/lib/mail-notifications";
import EmptyState from "@/components/common/empty-state";
import { NotificationIcon } from "@/components/common/notification-icon";
import { Skeleton } from "@/components/ui/skeleton";

const { palette } = brand;

const FILTERS = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "updates", label: "Updates" },
];

const EMPTY_BY_FILTER = {
  all: { title: "No notifications yet", description: "Updates about your mailbox will appear here." },
  unread: { title: "You're all caught up", description: "You have no unread notifications." },
  updates: { title: "No updates yet", description: "News about your requests and shipments will appear here." },
};

/** Sombra suave de las tarjetas, la misma que en el resto del diseño. */
const CARD_SHADOW = {
  shadowColor: "#1D4E4A",
  shadowOpacity: 0.06,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 3 },
  elevation: 2,
};

/**
 * Fondos de la tarjeta, siempre opacos. En Android la sombra (elevation) se
 * pinta debajo de la vista, y con un fondo translucido se transparenta: lo no
 * leido salia con un recuadro oscuro alrededor, como seleccionado.
 */
const ROW_BACKGROUND = {
  unread: overWhite(palette.tint, 0.14),
  unreadPressed: overWhite(palette.tint, 0.3),
  read: "#ffffff",
  readPressed: overWhite(palette.tint, 0.18),
};
const ROW_BORDER = overWhite(palette.ink, 0.07);

function NotificationRow({ notification, onOpen }) {
  const [pressed, setPressed] = useState(false);
  const unread = !notification.readAt;
  const background = ROW_BACKGROUND[(unread ? "unread" : "read") + (pressed ? "Pressed" : "")];
  const { title, message } = notificationDisplay(notification);

  return (
    <Pressable
      onPress={() => onOpen(notification)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      // Lo no leido se distingue por el punto y un velo de marca muy suave.
      className="mb-3 flex-row items-center gap-3.5 rounded-2xl border py-4 pl-6 pr-3"
      style={[CARD_SHADOW, { backgroundColor: background, borderColor: ROW_BORDER }]}
    >
      {unread ? <View className="absolute left-2 top-1/2 -mt-1 h-2.5 w-2.5 rounded-full bg-rose-500" /> : null}

      <NotificationIcon notification={notification} />

      <View className="min-w-0 flex-1 gap-0.5">
        <Text numberOfLines={2} className="font-hanken-bold text-[16px] text-ink">
          {title}
        </Text>
        {message ? (
          <Text numberOfLines={2} className="font-hanken text-[14px] leading-5 text-ink/70">
            {message}
          </Text>
        ) : null}
        <Text className="mt-0.5 font-hanken-medium text-[12px] text-ink/55">{formatEventTime(notification.createdAt)}</Text>
      </View>

      <ChevronRight size={20} color={palette.ink} />
    </Pressable>
  );
}

/** All / Unread / Updates, como pastillas sobre una barra blanca. */
function FilterTabs({ value, onChange, unreadCount }) {
  return (
    <View className="mb-4 flex-row gap-1.5 rounded-2xl bg-white p-1.5" style={CARD_SHADOW}>
      {FILTERS.map((filter) => {
        const active = filter.key === value;
        const label = filter.key === "unread" && unreadCount > 0 ? `${filter.label} (${unreadCount})` : filter.label;

        return (
          <Pressable
            key={filter.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(filter.key)}
            className={cn("flex-1 items-center rounded-xl py-2.5", active ? "bg-primary" : "active:bg-tint/20")}
          >
            <Text
              numberOfLines={1}
              className={cn("font-hanken-semibold text-[15px]", active ? "text-white" : "text-ink")}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function NotificationsScreen() {
  const { openType } = useLocalSearchParams();
  const opened = useRef(false);
  const [filter, setFilter] = useState("all");

  const query = useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: async () => (await api.get("/client/notifications", { params: { take: 50 } })).data,
  });

  const queryClient = useQueryClient();
  // Los avisos de correo sin leer se ven como uno: "You have 2 new mail items".
  const items = useMemo(() => stackMailNotifications(query.data?.items), [query.data]);
  const unreadCount = items.filter((item) => !item.readAt).length;

  const visible = useMemo(() => {
    if (filter === "unread") return items.filter((item) => !item.readAt);
    if (filter === "updates") return items.filter(isUpdateNotification);
    return items;
  }, [items, filter]);

  const markAllRead = useMutation({
    mutationFn: async () => (await api.patch("/client/notifications/read-all")).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["client-notifications"] }),
    onError: (error) => Alert.alert("Could not mark as read", formatErrorMessage(error, "Please try again.")),
  });

  /**
   * Un aviso de correo lleva a la pieza, o a la bandeja si son varias, y deja
   * leidos todos los que apila. El resto abre su detalle, que los marca alli.
   */
  const openNotification = (notification) => {
    // El de pagar el franqueo abre la pieza, donde esta el pago (el mismo
    // destino que el push). Se marca leido aqui porque no pasa por el detalle.
    const data = { ...(notification.data || {}), type: notification.type };
    if (isItemActionNotification(data)) {
      router.push(routeForNotification(data));
      if (!notification.readAt) {
        api.patch("/client/notifications/" + encodeURIComponent(notification.id) + "/read")
          .then(() => queryClient.invalidateQueries({ queryKey: ["client-notifications"] }))
          .catch(() => {});
      }
      return;
    }

    if (!isMailReceived(notification)) {
      router.push({ pathname: "/notifications/[id]", params: { id: notification.id } });
      return;
    }

    router.push(routeForMailReceived(notification.data));

    const unreadIds = notification.readAt ? [] : notification.stackedIds || [notification.id];
    if (unreadIds.length) {
      Promise.all(unreadIds.map((id) => api.patch("/client/notifications/" + encodeURIComponent(id) + "/read")))
        .then(() => queryClient.invalidateQueries({ queryKey: ["client-notifications"] }))
        .catch(() => {});
    }
  };

  /**
   * SOLO COMPATIBILIDAD con pushes antiguos que no traian notificationId.
   *
   * No es el camino normal: un push actual lleva el id y va directo al detalle
   * sin pasar por aqui (ver routeForNotification). Este bloque solo se activa si
   * la ruta llega con `openType`, cosa que unicamente produce la rama legacy.
   * Se hace una vez: volver atras desde el detalle no debe reabrirla.
   */
  useEffect(() => {
    const list = query.data?.items || [];
    if (opened.current || !openType || !list.length) return;

    const target = list.find((item) => item.type === openType);
    if (!target) return;

    opened.current = true;
    router.push({ pathname: "/notifications/[id]", params: { id: target.id } });
  }, [query.data, openType]);

  const header = (
    <Stack.Screen
      options={{
        // Se entra desde la campana del panel. Esta pantalla es la primera de
        // su pila, asi que sin esto no habria flecha para volver.
        headerLeft: () => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={12}
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/dashboard"))}
            className="-ml-1 p-1 active:opacity-60"
          >
            <ArrowLeft size={24} color={palette.ink} />
          </Pressable>
        ),
        headerRight: () =>
          unreadCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              disabled={markAllRead.isPending}
              onPress={() => markAllRead.mutate()}
              className="active:opacity-60"
            >
              {markAllRead.isPending ? (
                <ActivityIndicator size="small" color={brand.primaryColor} />
              ) : (
                <Text className="font-hanken-medium text-[13px]" style={{ color: palette.glyph }}>
                  Mark all as read
                </Text>
              )}
            </Pressable>
          ) : null,
      }}
    />
  );

  if (query.isLoading) {
    return (
      <View className="flex-1 gap-3 bg-canvas p-4">
        {header}
        <Skeleton className="h-14 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </View>
    );
  }

  const empty = EMPTY_BY_FILTER[filter];

  return (
    <>
      {header}
      <FlatList
        className="flex-1 bg-canvas"
        contentContainerClassName="p-4 pb-24"
        data={visible}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={<FilterTabs value={filter} onChange={setFilter} unreadCount={unreadCount} />}
        renderItem={({ item }) => <NotificationRow notification={item} onOpen={openNotification} />}
        refreshControl={<RefreshControl refreshing={query.isFetching && !query.isLoading} onRefresh={query.refetch} />}
        ListEmptyComponent={
          query.isError ? (
            <EmptyState title="Unable to load notifications" description={formatErrorMessage(query.error)} />
          ) : (
            <EmptyState title={empty.title} description={empty.description} />
          )
        }
      />
    </>
  );
}
