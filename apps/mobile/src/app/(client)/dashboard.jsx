import { useMemo } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useQuery } from "@tanstack/react-query";
import { Bell, CheckCircle2, ExternalLink, Inbox, MapPin, UserRound, UsersRound } from "lucide-react-native";

import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { ACTION_STATUSES, COMPLETED_STATUSES, getMailItems } from "@/lib/mail-item-display";
import { cn } from "@/lib/utils";
import EmptyState from "@/components/common/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

const CONFERENCE_ROOM_URL = "https://orlando.theworxoffices.com/conference-room/";

function getClientName(user) {
  return user?.name || user?.fullName || user?.clientProfile?.name || user?.email || "Client";
}

function getClientAddress(user) {
  const address = user?.clientProfile?.forwardingAddress || user?.forwardingAddress || user?.address || {};
  const parts = [
    address.address1 || address.line1,
    address.address2 || address.line2,
    address.city,
    address.state,
    address.zip || address.postalCode,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : "No forwarding address on file";
}

function itemDate(item) {
  return item.completedAt || item.updatedAt || item.receivedAt || item.createdAt;
}

function StatTile({ value, label, loading }) {
  return (
    <View className="flex-1 items-center justify-center rounded-md border border-white/10 bg-black/20 px-2 py-4">
      {loading ? (
        <Skeleton className="h-9 w-10 bg-white/20" />
      ) : (
        <Text className="text-4xl font-light leading-none text-white">{value}</Text>
      )}
      <Text className="mt-2 text-xs font-medium text-white">{label}</Text>
    </View>
  );
}

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

  const query = useQuery({
    queryKey: ["client-mail-items"],
    queryFn: async () => {
      const response = await api.get("/client/mail-items");
      return response.data;
    },
  });

  const mailItems = useMemo(() => getMailItems(query.data), [query.data]);
  const folders = useMemo(() => (Array.isArray(query.data?.folders) ? query.data.folders : []), [query.data]);
  const folderNotificationCount = (key) => Number(folders.find((folder) => folder.key === key)?.notificationCount || 0);

  const inboxItems = useMemo(() => mailItems.filter((item) => item.status !== "PICKED_UP").slice(0, 6), [mailItems]);
  const actionItems = useMemo(
    () => mailItems.filter((item) => ACTION_STATUSES.includes(item.status)).slice(0, 6),
    [mailItems]
  );
  const completedItems = useMemo(
    () =>
      mailItems
        .filter((item) => COMPLETED_STATUSES.includes(item.status))
        .sort((a, b) => new Date(itemDate(b) || 0).getTime() - new Date(itemDate(a) || 0).getTime())
        .slice(0, 6),
    [mailItems]
  );

  const openFolder = (folder) => () => router.push({ pathname: "/mail-items", params: { folder } });

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-6 p-4 pb-24"
      refreshControl={<RefreshControl refreshing={query.isFetching && !query.isLoading} onRefresh={query.refetch} />}
    >
      <View className="overflow-hidden rounded-lg border border-border bg-card">
        <View className="gap-5 p-5">
          <View className="flex-row items-start gap-4">
            <View className="h-12 w-12 items-center justify-center rounded-lg bg-primary">
              <UserRound size={24} color="#0f172a" />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Client Dashboard
              </Text>
              <Text className="mt-1 text-2xl font-semibold tracking-tight text-foreground" numberOfLines={1}>
                {getClientName(user)}
              </Text>
              <View className="mt-2 flex-row items-start gap-2">
                <MapPin size={16} color="#65baaf" style={{ marginTop: 2 }} />
                <Text className="flex-1 text-sm leading-5 text-muted-foreground">{getClientAddress(user)}</Text>
              </View>
            </View>
          </View>

          <View className="flex-row gap-3 rounded-lg bg-slate-800 p-3">
            <StatTile value={inboxItems.length} label="Inbox" loading={query.isLoading} />
            <StatTile value={actionItems.length} label="Actions" loading={query.isLoading} />
            <StatTile value={completedItems.length} label="Complete" loading={query.isLoading} />
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
