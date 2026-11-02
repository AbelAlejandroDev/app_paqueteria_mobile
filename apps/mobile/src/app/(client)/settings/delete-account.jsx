import { useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, Switch, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { brand } from "@/lib/brand";
import { formatErrorMessage } from "@/lib/utils";
import { deletionRequestBody, deletionStatusCopy, describeMembershipEffect, describeNoticeRule } from "@/lib/account-deletion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Pedir que se borre la cuenta (Google Play: Account Deletion).
 *
 * Usa el mismo backend que el portal web (/client/account-deletion). Explica
 * la diferencia con cancelar la membresia, que se borra y que se conserva, y
 * que pasa con una membresia activa; despues pide la contraseña, una
 * confirmacion explicita y un ultimo "si". Enviar registra una solicitud que
 * revisa el centro: no se borra ningun dato al pulsar.
 */

const QUERY_KEY = ["client-account-deletion"];

const TONES = {
  amber: "border-amber-200 bg-amber-50",
  emerald: "border-emerald-200 bg-emerald-50",
  rose: "border-rose-200 bg-rose-50",
  slate: "border-border bg-muted",
};

function StatusCard({ request }) {
  const copy = deletionStatusCopy(request.status);
  return (
    <View className={`gap-1.5 rounded-xl border p-4 ${TONES[copy.tone] || TONES.slate}`}>
      <Text className="font-brand-bold text-[15px] text-ink">{copy.title}</Text>
      <Text className="font-brand text-sm leading-5 text-ink/80">{copy.body}</Text>
      {request.status === "WAITING_MEMBERSHIP_CANCELLATION" && request.display?.expectedMembershipEndAt ? (
        <Text className="font-brand-semibold text-sm text-ink">Expected membership end: {request.display.expectedMembershipEndAt}</Text>
      ) : null}
      {request.decisionReason && ["REJECTED", "INFO_REQUIRED"].includes(request.status) ? (
        <Text className="font-brand-semibold text-sm text-ink">Message from your center: {request.decisionReason}</Text>
      ) : null}
      {request.display?.requestedAt ? <Text className="font-brand text-xs text-ink/60">Requested on {request.display.requestedAt}</Text> : null}
    </View>
  );
}

function Bullets({ title, lines }) {
  if (!lines?.length) return null;
  return (
    <View className="gap-1.5">
      <Text className="font-brand-bold text-sm text-ink">{title}</Text>
      {lines.map((line) => (
        <Text key={line} className="font-brand text-sm leading-5 text-muted-foreground">• {line}</Text>
      ))}
    </View>
  );
}

export default function DeleteAccountScreen() {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => (await api.get("/client/account-deletion")).data,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    // Pedir el borrado puede abrir la baja de la membresia.
    queryClient.invalidateQueries({ queryKey: ["client-membership-cancellation"] });
  };

  const submit = useMutation({
    mutationFn: async (body) => (await api.post("/client/account-deletion", body)).data,
    onSuccess: () => {
      setPassword("");
      setReason("");
      setAcknowledged(false);
      refresh();
      Alert.alert("Request sent", "Your center will review your account deletion request. We'll keep you updated by email.");
    },
    onError: (error) => {
      Alert.alert("Could not send the request", formatErrorMessage(error, "Try again later."));
      if (error?.response?.data?.code === "ACCOUNT_DELETION_ALREADY_REQUESTED") refresh();
    },
  });

  const withdraw = useMutation({
    mutationFn: async (id) => (await api.post(`/client/account-deletion/${encodeURIComponent(id)}/withdraw`, {})).data,
    onSuccess: refresh,
    onError: (error) => Alert.alert("Could not withdraw the request", formatErrorMessage(error, "Try again later.")),
  });

  const data = query.data;
  const request = data?.request || null;
  const membershipNote = describeMembershipEffect(data?.membership);
  // Los dias del preaviso salen de la baja que ya hay o de la que se abriria.
  const noticeRule = describeNoticeRule(data?.membership?.cancellation?.noticePeriodDays ?? data?.membership?.plan?.noticePeriodDays);

  const confirm = () => {
    const prepared = deletionRequestBody({ password, reason, acknowledged });
    if (!prepared.ok) {
      Alert.alert("Almost there", prepared.message);
      return;
    }
    Alert.alert(
      "Request account deletion?",
      `This sends a request to your center to delete your ${brand.appName || brand.name} account and personal data. Nothing is deleted right now.`,
      [
        { text: "Keep my account", style: "cancel" },
        { text: "Send request", style: "destructive", onPress: () => submit.mutate(prepared.body) },
      ]
    );
  };

  return (
    <ScrollView
      className="flex-1 bg-canvas"
      contentContainerClassName="gap-4 p-4 pb-24"
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}
    >
      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle className="text-lg">Delete Account</CardTitle>
          <CardDescription>
            {data?.retention?.difference || "Ask us to delete your account and your personal data."}
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-4 p-4 pt-4">
          {query.isLoading ? <Skeleton className="h-24 w-full" /> : null}
          {query.isError ? (
            <Text className="font-brand text-sm text-muted-foreground">{formatErrorMessage(query.error, "Unable to load this page.")}</Text>
          ) : null}

          {request ? <StatusCard request={request} /> : null}
          {request?.canWithdraw ? (
            <Button variant="outline" loading={withdraw.isPending} onPress={() => withdraw.mutate(request.id)}>
              Withdraw request
            </Button>
          ) : null}

          {data?.canRequest ? (
            <View className="gap-4">
              <Bullets title="What we delete" lines={data.retention?.deleted} />
              <Bullets title="What we may have to keep" lines={data.retention?.retained} />
              {membershipNote ? (
                <View className={`gap-2 rounded-xl border p-4 ${TONES.amber}`}>
                  <Text className="font-brand-semibold text-sm leading-5 text-ink">
                    Deleting your account also starts the cancellation of your membership.
                  </Text>
                  <Text className="font-brand text-sm leading-5 text-ink">{membershipNote}</Text>
                  {noticeRule ? <Text className="font-brand text-sm leading-5 text-ink/80">{noticeRule}</Text> : null}
                </View>
              ) : null}

              <View className="gap-2">
                <Label>Reason (optional)</Label>
                <Textarea value={reason} onChangeText={setReason} maxLength={500} />
              </View>
              <View className="gap-2">
                <Label>Your password</Label>
                <Input value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="current-password" textContentType="password" />
              </View>
              <Pressable onPress={() => setAcknowledged((v) => !v)} className="flex-row items-start gap-3">
                <Switch value={acknowledged} onValueChange={setAcknowledged} />
                <Text className="min-w-0 flex-1 font-brand text-sm leading-5 text-ink">
                  I understand that my account and personal data will be deleted once the request is approved, except the records the law requires to keep.
                </Text>
              </Pressable>

              <Button variant="destructive" loading={submit.isPending} onPress={confirm}>
                Request Account Deletion
              </Button>
            </View>
          ) : null}
        </CardContent>
      </Card>
    </ScrollView>
  );
}
