import { useEffect, useRef } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { formatDate, formatErrorMessage } from "@/lib/utils";
import { NOTIFICATIONS_QUERY_KEY } from "@/lib/notification-routing";
import EmptyState from "@/components/common/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

function NotificationRow({ notification }) {
  const unread = !notification.readAt;

  return (
    <Pressable
      onPress={() => router.push({ pathname: "/notifications/[id]", params: { id: notification.id } })}
      className="mb-3 flex-row items-start gap-3 rounded-lg border border-border bg-card p-4 active:bg-muted"
    >
      {/* El mismo punto rojo que marca lo nuevo en el resto de la app. */}
      <View className="mt-1.5 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: unread ? "#f43f5e" : "transparent" }} />
      <View className="min-w-0 flex-1 gap-1">
        <Text
          numberOfLines={2}
          className={unread ? "text-base font-semibold text-foreground" : "text-base font-medium text-foreground"}
        >
          {notification.title}
        </Text>
        <Text numberOfLines={2} className="text-sm leading-5 text-muted-foreground">
          {notification.message}
        </Text>
        <Text className="text-xs text-muted-foreground">{formatDate(notification.createdAt)}</Text>
      </View>
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const { openType } = useLocalSearchParams();
  const opened = useRef(false);

  const query = useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: async () => (await api.get("/client/notifications", { params: { take: 50 } })).data,
  });

  const items = query.data?.items || [];

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

  if (query.isLoading) {
    return (
      <View className="flex-1 gap-3 bg-background p-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </View>
    );
  }

  return (
    <FlatList
      className="flex-1 bg-background"
      contentContainerClassName="p-4 pb-24"
      data={items}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <NotificationRow notification={item} />}
      refreshControl={<RefreshControl refreshing={query.isFetching && !query.isLoading} onRefresh={query.refetch} />}
      ListEmptyComponent={
        query.isError ? (
          <EmptyState title="Unable to load notifications" description={formatErrorMessage(query.error)} />
        ) : (
          <EmptyState title="No notifications yet" description="Updates about your mailbox will appear here." />
        )
      }
    />
  );
}
