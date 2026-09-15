import { Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { formatDate, formatErrorMessage } from "@/lib/utils";
import { feeScheduleBlocks } from "@/lib/fee-schedule-format";
import EmptyState from "@/components/common/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * La tabla de tarifas (Fee Schedule) del centro del cliente.
 *
 * La escribe el administrador de cada centro en texto plano
 * (GET /client/fee-schedule, del centro de su buzon). Es un documento para leer:
 * cambiarlo no cambia ningun cobro. Los terminos la dan por incorporada, asi que
 * se ve en Billing y tambien al final de los terminos, donde se acepta con ellos.
 */

export const FEE_SCHEDULE_QUERY_KEY = ["client-fee-schedule"];

export function useFeeSchedule({ enabled = true } = {}) {
  return useQuery({
    queryKey: FEE_SCHEDULE_QUERY_KEY,
    queryFn: async () => (await api.get("/client/fee-schedule")).data?.feeSchedule || null,
    enabled,
  });
}

function FeeScheduleBlock({ block }) {
  if (block.kind === "space") return <View style={{ height: 8 }} />;

  if (block.kind === "heading") {
    return <Text className="mt-2 text-base font-semibold text-foreground">{block.text}</Text>;
  }

  if (block.kind === "columnsHeader" || block.kind === "row") {
    const header = block.kind === "columnsHeader";
    return (
      <View
        className={
          header
            ? "flex-row items-start justify-between gap-4 border-b border-border pb-1"
            : "flex-row items-start justify-between gap-4 py-1"
        }
      >
        <Text
          className={
            header
              ? "min-w-0 flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              : "min-w-0 flex-1 text-sm leading-5 text-foreground"
          }
        >
          {block.left}
        </Text>
        <Text
          className={
            header
              ? "text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              : "max-w-[50%] text-right text-sm font-semibold leading-5 text-foreground"
          }
        >
          {block.right}
        </Text>
      </View>
    );
  }

  if (block.kind === "bullet") {
    return (
      <View className="flex-row gap-2">
        <Text className="text-sm leading-6 text-foreground">•</Text>
        <Text className="min-w-0 flex-1 text-sm leading-6 text-foreground">{block.text}</Text>
      </View>
    );
  }

  return <Text className="text-sm leading-6 text-foreground">{block.text}</Text>;
}

/**
 * El texto del centro, con sus filas de dos columnas como filas de verdad: los
 * espacios que alinean en su editor no alinean con la fuente del telefono.
 */
export function FeeScheduleText({ feeSchedule }) {
  const blocks = feeScheduleBlocks(feeSchedule.content);

  return (
    <View className="gap-1">
      {blocks.map((block, index) => (
        <FeeScheduleBlock key={index} block={block} />
      ))}
      {feeSchedule.updatedAt ? (
        <Text className="mt-3 text-xs text-muted-foreground">Last updated {formatDate(feeSchedule.updatedAt)}</Text>
      ) : null}
    </View>
  );
}

/** Pestaña de Billing. */
export default function FeeScheduleView() {
  const query = useFeeSchedule();

  if (query.isLoading) return <Skeleton className="h-64 w-full" />;

  if (query.isError) {
    return <EmptyState title="Unable to load the Fee Schedule" description={formatErrorMessage(query.error)} />;
  }

  if (!query.data) {
    return (
      <EmptyState
        title="No Fee Schedule yet"
        description="Your center hasn't published its Fee Schedule. Contact your center for current fees."
      />
    );
  }

  return (
    <View className="rounded-lg border border-border bg-card p-4">
      <FeeScheduleText feeSchedule={query.data} />
    </View>
  );
}
