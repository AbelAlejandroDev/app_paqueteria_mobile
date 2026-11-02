import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { formatErrorMessage } from "@/lib/utils";
import { describeCancellationPreview } from "@/lib/membership-cancellation";
import { cancellationRequestBody } from "@/lib/account-deletion";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const QUERY_KEY = ["client-membership-cancellation"];

/**
 * Pedir la baja de la membresia. La regla (dias de aviso, que cobro se hace y
 * cual no) la decide el servidor; aqui solo se enseña lo que dice y se pide
 * confirmacion antes de mandar la peticion.
 *
 * El motivo es opcional, como en el portal web. Va en la tarjeta y no en el
 * dialogo: Alert no admite texto en Android.
 */
export default function MembershipCancellation() {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => (await api.get("/client/membership/cancellation")).data,
  });

  const request = useMutation({
    mutationFn: async () => (await api.post("/client/membership/cancellation", cancellationRequestBody(reason))).data,
    onSuccess: () => {
      setReason("");
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
          <View className="gap-2">
            <Label>Reason (optional)</Label>
            <Textarea value={reason} onChangeText={setReason} maxLength={500} placeholder="Tell us why you're leaving" />
            <Button variant="outline" loading={request.isPending} onPress={confirm}>
              Request cancellation
            </Button>
          </View>
        ) : null}
      </CardContent>
    </Card>
  );
}
