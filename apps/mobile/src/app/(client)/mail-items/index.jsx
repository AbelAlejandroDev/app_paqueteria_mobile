import { useMemo } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  ImageIcon,
  Inbox,
  Mail,
  Package2,
  Trash2,
} from "lucide-react-native";
import { brand } from "@/lib/brand";

import { api } from "@/lib/api";
import { formatDate, formatErrorMessage } from "@/lib/utils";
import {
  FOLDER_LABELS,
  formatStatusDisplay,
  getCurrentStatusColor,
  getCurrentStatusLabel,
  getMailTypeLabel,
  getPrimaryPhoto,
  getStatusColor,
  normalizeFolders,
} from "@/lib/mail-item-display";
import EmptyState from "@/components/common/empty-state";
import PageTitle from "@/components/common/page-title";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const FOLDER_ICONS = {
  inbox: Inbox,
  pending: Clock3,
  action_required: AlertCircle,
  completed: CheckCircle2,
  trash: Trash2,
};

function FolderCard({ folder }) {
  const Icon = FOLDER_ICONS[folder.key] || Inbox;
  const count = Number(folder.count || 0);
  const notificationCount = Number(folder.notificationCount || 0);

  return (
    <Pressable
      onPress={() => router.setParams({ folder: folder.key })}
      className="mb-3 flex-row items-center gap-3 rounded-lg border border-border bg-card p-3 active:bg-muted"
    >
      <View className="h-11 w-11 items-center justify-center rounded-md border border-slate-200 bg-slate-100">
        <Icon size={22} color="#334155" />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
          {FOLDER_LABELS[folder.key] || folder.label}
        </Text>
        <Text className="mt-0.5 text-sm text-muted-foreground">
          {count} item{count === 1 ? "" : "s"}
        </Text>
      </View>
      {notificationCount > 0 ? (
        <View className="h-7 min-w-[28px] items-center justify-center rounded-full bg-rose-500 px-2">
          <Text className="text-xs font-semibold text-white">
            {notificationCount > 99 ? "99+" : notificationCount}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function StorageFeeNotice({ notice }) {
  const message =
    notice.phase === "GRACE_PERIOD_ENDED"
      ? "$25/day storage fee may apply"
      : "$25/day storage fee may begin " + notice.firstChargeDate;

  return (
    <View className="flex-row items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1">
      <AlertCircle size={14} color="#78350f" />
      <Text className="flex-1 text-[11px] font-semibold text-amber-900" numberOfLines={1}>
        {message}
      </Text>
    </View>
  );
}

function MailItemCard({ item }) {
  const photo = getPrimaryPhoto(item);
  const TypeIcon = item.type === "PACKAGE" ? Package2 : Mail;
  const statusColor = getStatusColor(item.status);
  const currentColor = getCurrentStatusColor(item);

  return (
    <Card className="mb-4">
      <Pressable onPress={() => router.push("/mail-items/" + item.id)} className="flex-row active:opacity-80">
        <View style={{ height: 132 }} className="w-24 items-center justify-center bg-slate-100">
          {photo ? (
            <Image source={{ uri: photo.signedUrl }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
          ) : (
            <ImageIcon size={28} color="#94a3b8" />
          )}
        </View>

        <View className="min-w-0 flex-1 gap-2 p-3">
          <View className="flex-row items-center gap-2">
            <View className="h-8 w-8 items-center justify-center rounded-full bg-primary/10">
              <TypeIcon size={16} color={brand.primaryColor} />
            </View>
            <Text className="min-w-0 flex-1 text-base font-bold text-foreground" numberOfLines={1}>
              {item.itemCode || item.id}
            </Text>
          </View>

          <Text className="text-xs font-medium text-muted-foreground" numberOfLines={1}>
            {getMailTypeLabel(item.type)} · {formatDate(item.receivedAt || item.createdAt)}
          </Text>

          {item.storageFeeNotice ? <StorageFeeNotice notice={item.storageFeeNotice} /> : null}

          <View className="flex-row flex-wrap items-center gap-1.5">
            <Badge variant="outline" className={statusColor.container} labelClassName={statusColor.label}>
              {formatStatusDisplay(item.status)}
            </Badge>
            <Badge variant="outline" className={currentColor.container} labelClassName={currentColor.label}>
              {getCurrentStatusLabel(item)}
            </Badge>
          </View>
        </View>
      </Pressable>
    </Card>
  );
}

export default function MailItemsScreen() {
  const params = useLocalSearchParams();
  const selectedFolder = typeof params.folder === "string" && params.folder ? params.folder : "";

  const query = useQuery({
    queryKey: ["client-mail-items", selectedFolder || "folders"],
    queryFn: async () => {
      const response = selectedFolder
        ? await api.get("/client/mail-items", { params: { folder: selectedFolder } })
        : await api.get("/client/mail-items/folders");
      return response.data;
    },
  });

  const mailItems = query.data?.items || [];
  const mailbox = query.data?.mailbox || "";
  const folders = useMemo(() => normalizeFolders(query.data?.folders), [query.data?.folders]);
  const currentFolder = query.data?.currentFolder || folders.find((folder) => folder.key === selectedFolder);

  const isFolderLanding = !selectedFolder;
  const refreshControl = (
    <RefreshControl refreshing={query.isFetching && !query.isLoading} onRefresh={query.refetch} />
  );

  const header = (
    <View className="gap-4 pb-4">
      {selectedFolder ? (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          icon={<ArrowLeft size={16} color="#0f172a" />}
          onPress={() => router.setParams({ folder: "" })}
        >
          Back to folders
        </Button>
      ) : null}

      <PageTitle
        title={currentFolder?.label || "Mail"}
        subtitle={
          selectedFolder
            ? "Track what has arrived, what is ready, and what has already been handled."
            : "Choose a mailbox section."
        }
        actions={
          mailbox ? (
            <Badge className="border-primary/20 bg-primary/10 px-3 py-1.5" labelClassName="text-sm text-primary">
              {mailbox}
            </Badge>
          ) : null
        }
      />

      {query.isLoading ? (
        <View className="gap-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </View>
      ) : null}

      {query.isError ? (
        <EmptyState title="Failed to load mail items" description={formatErrorMessage(query.error)} />
      ) : null}
    </View>
  );

  const isBusy = query.isLoading || query.isError;

  if (isFolderLanding) {
    return (
      <FlatList
        className="flex-1 bg-background"
        contentContainerClassName="p-4 pb-24"
        data={isBusy ? [] : folders}
        keyExtractor={(folder) => folder.key}
        renderItem={({ item }) => <FolderCard folder={item} />}
        ListHeaderComponent={header}
        refreshControl={refreshControl}
      />
    );
  }

  return (
    <FlatList
      className="flex-1 bg-background"
      contentContainerClassName="p-4 pb-24"
      data={isBusy ? [] : mailItems}
      keyExtractor={(item) => String(item.id)}
      renderItem={({ item }) => <MailItemCard item={item} />}
      ListHeaderComponent={header}
      ListEmptyComponent={
        isBusy ? null : (
          <EmptyState title="No mail items yet" description="New deliveries will appear here. Check back soon." />
        )
      }
      refreshControl={refreshControl}
    />
  );
}
