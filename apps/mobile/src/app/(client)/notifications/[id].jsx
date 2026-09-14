import { useEffect, useRef } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react-native";

import { api } from "@/lib/api";
import { formatDate, formatErrorMessage } from "@/lib/utils";
import { isSafeUrl, planLabel, toBlocks, toSegments } from "@/lib/notification-content";
import { loadNotificationDetail, notificationDetailQueryKey } from "@/lib/notification-routing";
import { notificationDisplay } from "@/lib/mail-notifications";
import EmptyState from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Enlaces del texto: solo http(s), y siempre en el navegador del sistema.
 * javascript:, intent:, file: o data: no llegan a ser enlaces, y aunque llegaran,
 * aqui se vuelve a comprobar antes de abrir.
 */
function openLink(url) {
  if (isSafeUrl(url)) WebBrowser.openBrowserAsync(url);
}

function RichText({ text, className }) {
  return (
    <Text className={className}>
      {toSegments(text).map((segment, index) =>
        segment.kind === "link" ? (
          <Text
            key={index}
            onPress={() => openLink(segment.url)}
            accessibilityRole="link"
            className="text-primary underline"
          >
            {segment.url}
          </Text>
        ) : (
          <Text key={index}>{segment.text}</Text>
        )
      )}
    </Text>
  );
}

/**
 * El mensaje tal como lo manda el backend.
 *
 * Titulos, parrafos, saltos de linea, viñetas y enlaces salen del propio texto.
 * No se añade ninguna seccion desde la app ni se decide cual mostrar: el
 * contenido de cada plan ya viene resuelto, y repetirlo aqui daria dos fuentes
 * para el mismo mensaje.
 */
function MessageBody({ message }) {
  return (
    <View className="gap-3">
      {toBlocks(message).map((block, index) => {
        if (block.kind === "heading") {
          return (
            <Text key={index} className="mt-2 text-base font-semibold text-foreground">
              {block.text}
            </Text>
          );
        }

        if (block.kind === "bullets") {
          return (
            <View key={index} className="gap-2">
              {block.items.map((item, itemIndex) => (
                <View key={itemIndex} className="flex-row gap-2">
                  <Text className="text-sm leading-6 text-foreground">•</Text>
                  <RichText text={item} className="min-w-0 flex-1 text-sm leading-6 text-foreground" />
                </View>
              ))}
            </View>
          );
        }

        return <RichText key={index} text={block.text} className="text-sm leading-6 text-foreground" />;
      })}
    </View>
  );
}

/**
 * La bienvenida del 1583 se presenta como bienvenida y no como un aviso de
 * sistema. Lo unico que pone la app es la forma: el icono, y el plan como
 * etiqueta si viene en los datos. Titulo y texto son los del backend.
 */
function WelcomeHeader({ notification }) {
  const plan = planLabel(notification.data);

  return (
    <View className="items-center gap-3">
      <View className="h-16 w-16 items-center justify-center rounded-full bg-emerald-600">
        <CheckCircle2 size={34} color="#ffffff" />
      </View>
      <Text className="text-center text-xl font-semibold text-foreground">{notification.title}</Text>
      {plan ? (
        <Badge variant="outline" className="border-primary/30 bg-primary/10" labelClassName="text-foreground">
          {plan}
        </Badge>
      ) : null}
      <Text className="text-xs text-muted-foreground">{formatDate(notification.createdAt)}</Text>
    </View>
  );
}

function PlainHeader({ notification }) {
  return (
    <View className="gap-1">
      <Text className="text-xl font-semibold text-foreground">{notificationDisplay(notification).title}</Text>
      <Text className="text-xs text-muted-foreground">{formatDate(notification.createdAt)}</Text>
    </View>
  );
}

const HEADERS = {
  USPS_COMPLIANCE_APPROVED: WelcomeHeader,
};

export default function NotificationDetailScreen() {
  const { id } = useLocalSearchParams();
  const queryClient = useQueryClient();
  const marked = useRef(null);

  // Por su id y nada mas: no se descarga la lista para buscarla dentro.
  const query = useQuery({
    queryKey: notificationDetailQueryKey(id),
    queryFn: () => loadNotificationDetail(api, id),
    enabled: Boolean(id),
  });

  const notification = query.data || null;

  // Abrirla la marca como leida. No desaparece de la lista: solo pierde el punto.
  useEffect(() => {
    if (!notification || notification.readAt || marked.current === notification.id) return;
    marked.current = notification.id;

    api
      .patch("/client/notifications/" + notification.id + "/read")
      .then(() => queryClient.invalidateQueries({ queryKey: ["client-notifications"] }))
      .catch((error) => console.warn("Unable to mark notification as read", error?.message || error));
  }, [notification, queryClient]);

  if (query.isLoading) {
    return (
      <View className="flex-1 gap-4 bg-background p-4">
        <Skeleton className="h-64 w-full" />
      </View>
    );
  }

  if (query.isError || !notification) {
    const notFound = query.error?.response?.status === 404;
    return (
      <View className="flex-1 bg-background p-4">
        <EmptyState
          title={notFound || !notification ? "Notification not found" : "Unable to load notification"}
          description={notFound || !notification ? "It may have been removed." : formatErrorMessage(query.error)}
        />
      </View>
    );
  }

  const Header = HEADERS[notification.type] || PlainHeader;
  // Un aviso de una sola linea (el de correo) no repite el titulo como cuerpo.
  const body = HEADERS[notification.type] ? notification.message : notificationDisplay(notification).message;

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="p-4 pb-24">
      <Card>
        <CardContent className="gap-4 p-6">
          <Header notification={notification} />
          {body ? <MessageBody message={body} /> : null}
        </CardContent>
      </Card>
    </ScrollView>
  );
}
