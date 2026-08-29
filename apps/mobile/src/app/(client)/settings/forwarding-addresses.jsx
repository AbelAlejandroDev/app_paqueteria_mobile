import { ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { getClientAddress, hasClientAddress } from "@/lib/client-profile";
import { formatErrorMessage } from "@/lib/utils";
import EmptyState from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function AddressLine({ label, value }) {
  if (!value) return null;

  return (
    <View className="flex-row justify-between gap-4 py-1.5">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="flex-1 text-right text-sm font-medium text-foreground">{value}</Text>
    </View>
  );
}

export default function ForwardingAddressesScreen() {
  // La direccion viaja dentro del usuario autenticado, asi que se pide /auth/me
  // al entrar aqui en vez de cargarlo con el resto de Settings.
  const query = useQuery({
    queryKey: ["client-profile-me"],
    queryFn: async () => (await api.get("/auth/me")).data,
  });

  if (query.isLoading) {
    return (
      <View className="flex-1 gap-4 bg-background p-4">
        <Skeleton className="h-48 w-full" />
      </View>
    );
  }

  if (query.isError) {
    return (
      <View className="flex-1 gap-4 bg-background p-4">
        <EmptyState title="No se pudo cargar la dirección" description={formatErrorMessage(query.error)} />
        <Button variant="outline" onPress={() => query.refetch()}>
          Reintentar
        </Button>
      </View>
    );
  }

  const user = query.data?.user || query.data;
  const address = getClientAddress(user);

  if (!hasClientAddress(user)) {
    return (
      <View className="flex-1 bg-background p-4">
        <EmptyState
          title="Sin dirección de reenvío"
          description="Contacta con tu centro desde la pestaña Help para registrarla."
        />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-4 pb-24">
      <Card>
        <CardContent className="p-5">
          <AddressLine label="Destinatario" value={address.name} />
          <AddressLine label="Dirección" value={address.address1} />
          <AddressLine label="Línea 2" value={address.address2} />
          <AddressLine label="Ciudad" value={address.city} />
          <AddressLine label="Estado" value={address.state} />
          <AddressLine label="ZIP" value={address.zip} />
          <AddressLine label="País" value={address.country} />
        </CardContent>
      </Card>

      <Text className="px-1 text-sm leading-5 text-muted-foreground">
        Para modificarla, contacta con tu centro desde la pestaña Help.
      </Text>
    </ScrollView>
  );
}
