import { RefreshControl, ScrollView, Text } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { formatDate, formatErrorMessage } from "@/lib/utils";
import EmptyState from "@/components/common/empty-state";
import { CardHeading, CardSubheading, DetailCard } from "@/components/common/mail-item-detail-ui";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Los Terms & Conditions vigentes del centro del cliente, para volver a
 * leerlos cuando quiera. Solo lectura: aceptarlos se hace en TermsGate.
 *
 * Misma consulta y misma clave que TermsGate (GET /auth/terms/current), asi
 * que comparten cache. El servidor manda el texto completo y, si ya los
 * acepto, la fecha.
 */
export default function TermsScreen() {
  const query = useQuery({
    queryKey: ["auth-terms-current"],
    queryFn: async () => (await api.get("/auth/terms/current")).data,
  });

  const terms = query.data?.terms || null;
  const acceptedAt = query.data?.acceptance?.acceptedAt || null;

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-24"
      refreshControl={<RefreshControl refreshing={query.isFetching && !query.isLoading} onRefresh={() => query.refetch()} />}
    >
      {query.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : query.isError ? (
        <EmptyState title="Unable to load the Terms & Conditions" description={formatErrorMessage(query.error)} />
      ) : !terms ? (
        <EmptyState
          title="No Terms & Conditions yet"
          description="Your center hasn't published its Terms & Conditions. Contact your center if you have questions."
        />
      ) : (
        <DetailCard className="p-5">
          <CardHeading>{terms.title || "Terms & Conditions"}</CardHeading>
          <CardSubheading className="mb-3">
            {[terms.version ? "Version " + terms.version : null, acceptedAt ? "Accepted " + formatDate(acceptedAt) : null]
              .filter(Boolean)
              .join(" · ") || " "}
          </CardSubheading>
          {/* El administrador lo escribe en texto plano: los saltos de linea que
              puso son los que se ven. */}
          <Text className="font-brand text-[14px] leading-6 text-ink">{terms.content || ""}</Text>
        </DetailCard>
      )}
    </ScrollView>
  );
}
