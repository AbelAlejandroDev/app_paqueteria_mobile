import { useEffect, useRef } from "react";
import { ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock3, Hash } from "lucide-react-native";

import { api } from "@/lib/api";
import { brand } from "@/lib/brand";
import { formatErrorMessage } from "@/lib/utils";
import { formatEventTime } from "@/lib/mail-item-detail";
import { isSafeUrl, planLabel, toBlocks, toSegments } from "@/lib/notification-content";
import { loadNotificationDetail, notificationDetailQueryKey } from "@/lib/notification-routing";
import { notificationDisplay } from "@/lib/mail-notifications";
import { notificationKind, relatedAction } from "@/lib/notification-kind";
import EmptyState from "@/components/common/empty-state";
import { ActionButton, DetailCard, MailboxChip } from "@/components/common/mail-item-detail-ui";
import { NotificationIcon, notificationStyle } from "@/components/common/notification-icon";
import { Skeleton } from "@/components/ui/skeleton";

const { palette } = brand;

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
            className="font-hanken-semibold underline"
            style={{ color: palette.glyph }}
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
            <Text key={index} className="mt-2 font-hanken-bold text-[16px] text-ink">
              {block.text}
            </Text>
          );
        }

        if (block.kind === "bullets") {
          return (
            <View key={index} className="gap-2">
              {block.items.map((item, itemIndex) => (
                <View key={itemIndex} className="flex-row gap-2.5">
                  <View className="mt-[9px] h-1.5 w-1.5 rounded-full" style={{ backgroundColor: brand.primaryColor }} />
                  <RichText text={item} className="min-w-0 flex-1 font-hanken text-[15px] leading-6 text-ink/80" />
                </View>
              ))}
            </View>
          );
        }

        return <RichText key={index} text={block.text} className="font-hanken text-[15px] leading-6 text-ink/80" />;
      })}
    </View>
  );
}

/** La fecha en una pastilla discreta bajo el titulo. */
function TimeChip({ value }) {
  const time = formatEventTime(value);
  if (!time) return null;

  return (
    <View className="flex-row items-center gap-1.5 rounded-full bg-ink/[0.05] px-3 py-1">
      <Clock3 size={13} color={palette.glyph} />
      <Text className="font-hanken-medium text-[13px] text-ink/60">{time}</Text>
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
      <View className="h-[72px] w-[72px] items-center justify-center rounded-full" style={{ backgroundColor: palette.success }}>
        <CheckCircle2 size={38} color="#ffffff" />
      </View>
      <Text className="text-center font-hanken-bold text-[22px] leading-7 tracking-tight text-ink">
        {notification.title}
      </Text>
      {plan ? <MailboxChip>{plan}</MailboxChip> : null}
      <TimeChip value={notification.createdAt} />
    </View>
  );
}

/** Cabecera de cualquier otro aviso: el mismo icono y color que en la lista. */
function PlainHeader({ notification }) {
  return (
    <View className="items-center gap-3">
      <NotificationIcon notification={notification} size={72} />
      <Text className="text-center font-hanken-bold text-[22px] leading-7 tracking-tight text-ink">
        {notificationDisplay(notification).title}
      </Text>
      <TimeChip value={notification.createdAt} />
    </View>
  );
}

const HEADERS = {
  USPS_COMPLIANCE_APPROVED: WelcomeHeader,
};

/**
 * Datos sueltos que el aviso trae aparte del texto y que el cliente puede
 * querer copiar, como el numero de seguimiento. Seleccionable: mantener
 * pulsado lo copia sin añadir un modulo nativo para el portapapeles.
 */
function TrackingRow({ trackingNumber }) {
  return (
    <View className="flex-row items-center gap-3 rounded-[10px] border border-ink/[0.08] bg-canvas px-4 py-3">
      <Hash size={18} color={palette.glyph} />
      <View className="min-w-0 flex-1">
        <Text className="font-hanken text-[12px] uppercase tracking-wider text-ink/55">Tracking number</Text>
        <Text selectable className="font-hanken-bold text-[15px] text-ink">
          {trackingNumber}
        </Text>
      </View>
    </View>
  );
}

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
      <View className="flex-1 gap-4 bg-canvas p-4">
        <Skeleton className="h-56 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
      </View>
    );
  }

  if (query.isError || !notification) {
    const notFound = query.error?.response?.status === 404;
    return (
      <View className="flex-1 bg-canvas p-4">
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
  const trackingNumber = notification.data?.trackingNumber ? String(notification.data.trackingNumber) : "";
  const action = relatedAction(notification);
  // El color del aviso tiñe la franja de arriba, para que el detalle se
  // reconozca con la misma mirada que la fila de la lista.
  const accent = HEADERS[notification.type] ? palette.success : notificationStyle(notification).color;

  return (
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="gap-4 p-4 pb-24">
      <DetailCard>
        <View className="h-1.5 w-full" style={{ backgroundColor: accent }} />
        <View className="gap-5 p-6">
          <Header notification={notification} />

          {body || trackingNumber ? <View className="h-px bg-ink/[0.08]" /> : null}

          {body ? <MessageBody message={body} /> : null}
          {trackingNumber ? <TrackingRow trackingNumber={trackingNumber} /> : null}
        </View>
      </DetailCard>

      {action ? (
        <ActionButton
          variant="primary"
          onPress={() => router.push(action.route)}
          accessibilityHint={notificationKind(notification) === "mail" ? "Opens your mail" : undefined}
        >
          {action.label}
        </ActionButton>
      ) : null}
    </ScrollView>
  );
}
