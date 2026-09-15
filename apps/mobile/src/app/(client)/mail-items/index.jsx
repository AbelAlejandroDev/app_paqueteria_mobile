import { useEffect, useMemo, useState } from "react";
import { Animated, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ImageIcon,
  Inbox,
  ListChecks,
  Mail,
  Package2,
  ScanLine,
  Store,
  Trash2,
  Truck,
} from "lucide-react-native";
import { brand } from "@/lib/brand";

import { api } from "@/lib/api";
import { formatDate, formatErrorMessage } from "@/lib/utils";
import {
  FOLDER_LABELS,
  getCurrentStatusColor,
  getCurrentStatusLabel,
  getItemStatusDisplay,
  getMailTypeLabel,
  getPrimaryPhoto,
  normalizeFolders,
} from "@/lib/mail-item-display";
import { isSelectable, selectedItemsFrom, toggleAll, toggleId } from "@/lib/mail-selection";
import BulkRequestSheet from "@/components/common/bulk-request-sheet";
import EmptyState from "@/components/common/empty-state";
import LetterForwardSheet from "@/components/common/letter-forward-sheet";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Coinciden con COMPLETED_FILTERS del backend. Se navegan como carpetas, igual
// que el primer nivel, y se solapan a proposito: un item recogido que antes se
// escaneo sale en varias.
const COMPLETED_FOLDERS = [
  { key: "all", label: "All Completed", icon: CheckCircle2 },
  { key: "scanned", label: "Opened & Scanned", icon: ScanLine },
  { key: "forwarding", label: "Forwarded", icon: Truck },
  { key: "shipments", label: "Shipments", icon: Package2 },
  { key: "picked-up", label: "Picked Up", icon: Store },
  // La clave sigue siendo "deleted" (la del backend); para el cliente es lo descartado.
  { key: "deleted", label: "Discarded", icon: Trash2 },
];

const FOLDER_ICONS = {
  inbox: Inbox,
  pending: Clock3,
  action_required: AlertCircle,
  completed: CheckCircle2,
  trash: Trash2,
};

/** Aviso de elementos sin ver, igual en carpetas y subcarpetas. */
function UnreadBadge({ count }) {
  if (!count) return null;

  return (
    <View className="h-7 min-w-[28px] items-center justify-center rounded-full bg-rose-500 px-2">
      <Text className="text-xs font-semibold text-white">{count > 99 ? "99+" : count}</Text>
    </View>
  );
}

/**
 * Subcarpeta de Completada.
 *
 * Se pinta como las de primer nivel para que se lean igual, contador incluido:
 * el aviso de la carpeta dice cuantos hay sin ver, y sin repartirlo aqui el
 * cliente entraba y no sabia cual de los seis tipos mirar.
 */
function CompletedFolderCard({ folder }) {
  const Icon = folder.icon;
  const count = Number(folder.count || 0);

  return (
    <Pressable
      onPress={() => router.setParams({ folder: "completed", filter: folder.key })}
      className="mb-3 flex-row items-center gap-3 rounded-lg border border-border bg-card p-3 active:bg-muted"
    >
      <View className="h-11 w-11 items-center justify-center rounded-md border border-slate-200 bg-slate-100">
        <Icon size={22} color="#334155" />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
          {folder.label}
        </Text>
        <Text className="mt-0.5 text-sm text-muted-foreground">
          {count} item{count === 1 ? "" : "s"}
        </Text>
      </View>
      <UnreadBadge count={folder.notificationCount} />
    </Pressable>
  );
}

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
      <UnreadBadge count={notificationCount} />
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

/** Espacio que se abre a la izquierda para la casilla. */
const CHECK_SPACE = 44;

function SelectionCheck({ checked, disabled = false }) {
  return (
    <View
      className={
        checked
          ? "h-6 w-6 items-center justify-center rounded-full border-2 border-primary bg-primary"
          : "h-6 w-6 items-center justify-center rounded-full border-2 border-slate-300 bg-card"
      }
      // Tamano fijo: dentro de un hueco estrecho se estiraba y salia ovalada.
      style={[{ width: 24, height: 24 }, disabled ? { opacity: 0.4 } : null]}
    >
      {checked ? <Check size={14} color={brand.primaryForeground} strokeWidth={3} /> : null}
    </View>
  );
}

/**
 * Una fila de la lista con su casilla.
 *
 * Todas las filas comparten el mismo valor animado, asi que al activar la
 * seleccion se desplazan a la derecha a la vez y la casilla aparece en el hueco.
 */
function SelectableRow({ progress, selectionMode, selectable, selected, onToggle, children }) {
  return (
    <View>
      <Animated.View
        pointerEvents={selectionMode ? "auto" : "none"}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 16,
          width: CHECK_SPACE - 8,
          justifyContent: "center",
          alignItems: "flex-start",
          opacity: progress,
        }}
      >
        <Pressable
          onPress={onToggle}
          disabled={!selectable}
          hitSlop={10}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected, disabled: !selectable }}
        >
          <SelectionCheck checked={selected} disabled={!selectable} />
        </Pressable>
      </Animated.View>
      <Animated.View style={{ marginLeft: progress.interpolate({ inputRange: [0, 1], outputRange: [0, CHECK_SPACE] }) }}>
        {children}
      </Animated.View>
    </View>
  );
}

function MailItemCard({ item, selectionMode = false, selectable = false, selected = false, onToggle }) {
  const photo = getPrimaryPhoto(item);
  const TypeIcon = item.type === "PACKAGE" ? Package2 : Mail;
  // El estado de la ultima solicitud si se rechazo o cancelo, no el que dejo la pieza.
  const statusDisplay = getItemStatusDisplay(item);
  const statusColor = statusDisplay.color;
  const currentColor = getCurrentStatusColor(item);
  // Mismo criterio que usa el backend para contar los avisos de la carpeta.
  const isUnread = item.viewStatus !== "VIEWED" && !item.viewedAt;

  return (
    <Card
      className={selected ? "mb-4 border-primary" : "mb-4"}
      style={selectionMode && !selectable ? { opacity: 0.5 } : null}
    >
      <Pressable
        onPress={() => {
          if (!selectionMode) {
            router.push("/mail-items/" + item.id);
            return;
          }
          // Las que no admiten ninguna solicitud en grupo no se marcan.
          if (selectable) onToggle?.();
        }}
        className="flex-row active:opacity-80"
      >
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
            {/* El mismo punto rojo del aviso de la carpeta, para que al entrar
                se vea de un vistazo cual es el que lo provocaba. */}
            {isUnread ? <View className="h-2.5 w-2.5 rounded-full bg-rose-500" /> : null}
          </View>

          <Text className="text-xs font-medium text-muted-foreground" numberOfLines={1}>
            {getMailTypeLabel(item.type)} · {formatDate(item.receivedAt || item.createdAt)}
          </Text>

          {item.storageFeeNotice ? <StorageFeeNotice notice={item.storageFeeNotice} /> : null}

          <View className="flex-row flex-wrap items-center gap-1.5">
            <Badge variant="outline" className={statusColor.container} labelClassName={statusColor.label}>
              {statusDisplay.label}
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

  const selectedFilter = typeof params.filter === "string" && params.filter ? params.filter : "";

  // Tres niveles: carpetas, subcarpetas de Completada, y la lista de items.
  // Completada sin subcarpeta elegida no pide items todavia.
  const isCompletedLanding = selectedFolder === "completed" && !selectedFilter;

  const query = useQuery({
    queryKey: ["client-mail-items", selectedFolder || "folders", selectedFilter],
    queryFn: async () => {
      if (!selectedFolder || isCompletedLanding) {
        return (await api.get("/client/mail-items/folders")).data;
      }

      return (
        await api.get("/client/mail-items", {
          params: {
            folder: selectedFolder,
            ...(selectedFilter ? { filter: selectedFilter } : {}),
          },
        })
      ).data;
    },
  });

  const mailItems = query.data?.items || [];
  const queryClient = useQueryClient();

  // La seleccion pertenece a la carpeta en la que se empezo: al cambiar de
  // carpeta se apaga sola, sin un efecto que la resetee.
  const folderKey = selectedFolder + ":" + selectedFilter;
  const [selection, setSelection] = useState({ folderKey: "", active: false, ids: [] });
  const selectionMode = selection.active && selection.folderKey === folderKey;
  const selectedIds = selectionMode ? selection.ids : [];
  const selectedItems = selectedItemsFrom(selectedIds, mailItems);
  const selectableItems = mailItems.filter(isSelectable);
  const allSelected = selectableItems.length > 0 && selectableItems.every((item) => selectedIds.includes(String(item.id)));

  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(progress, { toValue: selectionMode ? 1 : 0, duration: 220, useNativeDriver: false }).start();
  }, [selectionMode, progress]);

  const toggleSelectionMode = () =>
    setSelection((current) =>
      current.active && current.folderKey === folderKey
        ? { folderKey, active: false, ids: [] }
        : { folderKey, active: true, ids: [] }
    );
  const setIds = (update) => setSelection((current) => ({ ...current, ids: update(current.ids) }));

  const [bulk, setBulk] = useState({ open: false, key: 0 });
  const [forward, setForward] = useState({ open: false, key: 0, items: [] });

  const finishSelection = async () => {
    setSelection({ folderKey: "", active: false, ids: [] });
    await queryClient.invalidateQueries({ queryKey: ["client-mail-items"] });
  };

  const openForward = (items) => {
    setBulk((current) => ({ ...current, open: false }));
    // Una hoja se cierra antes de abrir la otra: dos Modal animandose a la vez
    // se pisan en iOS.
    setTimeout(() => setForward((current) => ({ open: true, key: current.key + 1, items })), 350);
  };
  // El backend manda los contadores por tipo de cierre; aqui solo se cruzan
  // con la etiqueta y el icono, que son cosa de la app.
  const completedFolders = useMemo(() => {
    const byKey = new Map((query.data?.completedFilterCounts || []).map((entry) => [entry.key, entry]));
    return COMPLETED_FOLDERS.map((folder) => ({ ...folder, ...byKey.get(folder.key) }));
  }, [query.data?.completedFilterCounts]);
  const folders = useMemo(() => normalizeFolders(query.data?.folders), [query.data?.folders]);

  const isFolderLanding = !selectedFolder;
  const refreshControl = (
    <RefreshControl refreshing={query.isFetching && !query.isLoading} onRefresh={query.refetch} />
  );

  const header = (
    <View className="gap-4 pb-4">
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

  /**
   * Cabecera nativa de la pantalla.
   *
   * Carpeta y listado comparten ruta (el `folder` es un parametro), asi que la
   * flecha no puede venir del Stack: se pinta aqui solo cuando hay carpeta
   * abierta y lo unico que hace es limpiar el parametro.
   */
  const isList = Boolean(selectedFolder) && !isCompletedLanding;
  const canSelect = isList && !isBusy && selectableItems.length > 0;

  const screenHeader = (
    <Stack.Screen
      options={{
        title: "Mail",
        headerTitleAlign: "center",
        headerLeft: selectedFolder
          ? () => (
              <Pressable
                // Sube un solo nivel: de una subcarpeta a Completada, y de una
                // carpeta a la raiz. Volver del todo de golpe obligaria a
                // rehacer el camino para ver otro tipo de cierre.
                onPress={() =>
                  selectedFilter
                    ? router.setParams({ folder: "completed", filter: "" })
                    : router.setParams({ folder: "", filter: "" })
                }
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Back to folders"
                className="pr-3"
              >
                <ArrowLeft size={24} color="#0f172a" />
              </Pressable>
            )
          : undefined,
        // Seleccionar varias, a la derecha y lejos de la flecha para no tocarla
        // por error. Funciona como interruptor: la segunda vez sale del modo y
        // desmarca todo.
        headerRight:
          canSelect || selectionMode
            ? () => (
                <Pressable
                  onPress={toggleSelectionMode}
                  hitSlop={10}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: selectionMode }}
                  accessibilityLabel="Select multiple mail items"
                  className={selectionMode ? "rounded-full bg-primary/15 p-1.5" : "rounded-full p-1.5"}
                >
                  <ListChecks size={22} color={selectionMode ? brand.primaryColor : "#0f172a"} />
                </Pressable>
              )
            : undefined,
      }}
    />
  );

  if (isCompletedLanding) {
    return (
      <>
        {screenHeader}
        <FlatList
          className="flex-1 bg-background"
          contentContainerClassName="p-4 pb-24"
          data={isBusy ? [] : completedFolders}
          keyExtractor={(folder) => folder.key}
          renderItem={({ item }) => <CompletedFolderCard folder={item} />}
          ListHeaderComponent={header}
          refreshControl={refreshControl}
        />
      </>
    );
  }

  if (isFolderLanding) {
    return (
      <>
        {screenHeader}
        <FlatList
          className="flex-1 bg-background"
          contentContainerClassName="p-4 pb-24"
          data={isBusy ? [] : folders}
          keyExtractor={(folder) => folder.key}
          renderItem={({ item }) => <FolderCard folder={item} />}
          ListHeaderComponent={header}
          refreshControl={refreshControl}
        />
      </>
    );
  }

  return (
    <>
      {screenHeader}

      {selectionMode ? (
        <View className="flex-row items-center gap-3 border-b border-border bg-card px-4 py-3">
          <Pressable
            onPress={() => setIds((ids) => toggleAll(ids, mailItems))}
            hitSlop={8}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: allSelected }}
            className="flex-row items-center gap-2"
          >
            <SelectionCheck checked={allSelected} />
            <Text className="text-sm font-semibold text-foreground">Select all</Text>
          </Pressable>

          <Text className="min-w-0 flex-1 text-sm text-muted-foreground" numberOfLines={1}>
            {selectedItems.length} selected
          </Text>

          {/* Desplegable de solicitudes para lo marcado. */}
          <Pressable
            onPress={() => setBulk((current) => ({ open: true, key: current.key + 1 }))}
            disabled={!selectedItems.length}
            accessibilityRole="button"
            className="flex-row items-center gap-1.5 rounded-lg bg-primary px-3 py-2"
            style={!selectedItems.length ? { opacity: 0.5 } : null}
          >
            <Text className="text-sm font-semibold text-primary-foreground">Request</Text>
            <ChevronDown size={16} color={brand.primaryForeground} />
          </Pressable>
        </View>
      ) : null}

      <FlatList
        className="flex-1 bg-background"
        contentContainerClassName="p-4 pb-24"
        data={isBusy ? [] : mailItems}
        keyExtractor={(item) => String(item.id)}
        extraData={selectedIds}
        renderItem={({ item }) => {
          const selectable = isSelectable(item);
          const selected = selectedIds.includes(String(item.id));
          const onToggle = () => setIds((ids) => toggleId(ids, item.id));

          return (
            <SelectableRow
              progress={progress}
              selectionMode={selectionMode}
              selectable={selectable}
              selected={selected}
              onToggle={onToggle}
            >
              <MailItemCard
                item={item}
                selectionMode={selectionMode}
                selectable={selectable}
                selected={selected}
                onToggle={onToggle}
              />
            </SelectableRow>
          );
        }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          isBusy ? null : (
            <EmptyState title="No mail items yet" description="New deliveries will appear here. Check back soon." />
          )
        }
        refreshControl={refreshControl}
      />

      <BulkRequestSheet
        key={"bulk-" + bulk.key}
        visible={bulk.open}
        onClose={() => setBulk((current) => ({ ...current, open: false }))}
        selectedItems={selectedItems}
        onForward={openForward}
        onCompleted={finishSelection}
      />

      {forward.items.length ? (
        <LetterForwardSheet
          key={"forward-" + forward.key}
          visible={forward.open}
          onClose={() => setForward((current) => ({ ...current, open: false }))}
          mailItems={forward.items}
          onCompleted={finishSelection}
        />
      ) : null}
    </>
  );
}
