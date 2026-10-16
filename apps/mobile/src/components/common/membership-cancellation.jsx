import { Alert, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { formatErrorMessage } from "@/lib/utils";
import { describeCancellationPreview } from "@/lib/membership-cancellation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const QUERY_KEY = ["client-membership-cancellation"];

/**
 * Pedir la baja de la membresia. La regla (dias de aviso, que cobro se hace y
 * cual no) la decide el servidor; aqui solo se enseña lo que dice y se pide
 * confirmacion antes de mandar la peticion.
 */
export default function MembershipCancellation() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => (await api.get("/client/membership/cancellation")).data,
  });

  const request = useMutation({
    mutationFn: async () => (await api.post("/client/membership/cancellation", {})).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      Alert.alert("Request sent", "Your center will review your cancellation request.");
    },
    onError: (error) => Alert.alert("Could not send the request", formatErrorMessage(error, "Try again later.")),
  });

  if (query.isLoading) return <Skeleton className="h-40 w-full" />;
  if (query.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Cancel membership</CardTitle>
          <CardDescription>{formatErrorMessage(query.error, "Unable to load cancellation details.")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const view = describeCancellationPreview(query.data);
  if (!view) return null;

  const confirm = () =>
    Alert.alert("Cancel membership?", view.lines.join("\n\n"), [
      { text: "Keep membership", style: "cancel" },
      { text: "Request cancellation", style: "destructive", onPress: () => request.mutate() },
    ]);

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="text-lg">Cancel membership</CardTitle>
        {view.kind === "existing" ? <CardDescription>{view.status}</CardDescription> : null}
      </CardHeader>
      <CardContent className="gap-3 p-4 pt-4">
        {view.lines.map((line) => (
          <Text key={line} className="text-sm leading-5 text-muted-foreground">{line}</Text>
        ))}
        {view.canRequest ? (
          <View>
            <Button variant="outline" loading={request.isPending} onPress={confirm}>
              Request cancellation
            </Button>
          </View>
        ) : null}
      </CardContent>
    </Card>
  );
}
