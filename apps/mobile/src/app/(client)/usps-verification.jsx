import { useState } from "react";
import { Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCheck2, Upload } from "lucide-react-native";

import { api } from "@/lib/api";
import { brand } from "@/lib/brand";
import { formatDate, formatErrorMessage } from "@/lib/utils";
import DocumentPickerField from "@/components/common/document-picker-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const STATUS_COLORS = {
  APPROVED: { container: "border-emerald-200 bg-emerald-100", label: "text-emerald-800" },
  REJECTED: { container: "border-rose-200 bg-rose-100", label: "text-rose-800" },
  SUBMITTED: { container: "border-sky-200 bg-sky-100", label: "text-sky-800" },
  PENDING: { container: "border-amber-200 bg-amber-100", label: "text-amber-800" },
};

const NEUTRAL_STATUS = { container: "border-slate-200 bg-slate-100", label: "text-slate-700" };

export default function UspsVerificationScreen() {
  const queryClient = useQueryClient();
  const [form1583, setForm1583] = useState(null);
  const [photoId, setPhotoId] = useState(null);
  const [addressId, setAddressId] = useState(null);
  const [photoIdType, setPhotoIdType] = useState("");
  const [addressIdType, setAddressIdType] = useState("");

  const query = useQuery({
    queryKey: ["client-usps-compliance"],
    queryFn: async () => (await api.get("/client/usps-compliance")).data,
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!form1583 || !photoId || !addressId) {
        throw new Error("Attach Form 1583 and both identification documents.");
      }

      // React Native construye el multipart a partir de {uri, name, type};
      // no existe el objeto File del navegador.
      const data = new FormData();
      data.append("form1583", { uri: form1583.uri, name: form1583.name, type: form1583.type });
      data.append("photoId", { uri: photoId.uri, name: photoId.name, type: photoId.type });
      data.append("addressId", { uri: addressId.uri, name: addressId.name, type: addressId.type });
      data.append("photoIdType", photoIdType);
      data.append("addressIdType", addressIdType);

      return api.post("/client/usps-compliance", data, {
        headers: { "Content-Type": "multipart/form-data" },
      });
    },
    onSuccess: () => {
      Alert.alert("Documents submitted", "Your USPS paperwork is now under review.");
      setForm1583(null);
      setPhotoId(null);
      setAddressId(null);
      setPhotoIdType("");
      setAddressIdType("");
      queryClient.invalidateQueries({ queryKey: ["client-usps-compliance"] });
    },
    onError: (error) => {
      Alert.alert("Could not submit", formatErrorMessage(error));
    },
  });

  if (query.isLoading) {
    return (
      <View className="flex-1 gap-4 bg-background p-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </View>
    );
  }

  const record = query.data?.record;
  const status = record?.status || "NOT SUBMITTED";
  const statusColor = STATUS_COLORS[status] || NEUTRAL_STATUS;

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-6 p-4 pb-24"
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={query.isFetching && !query.isLoading} onRefresh={query.refetch} />}
    >
      <Card>
        <CardHeader>
          <View className="flex-row items-start gap-3">
            <View className="rounded-xl bg-primary/10 p-3">
              <FileCheck2 size={24} color={brand.primaryColor} />
            </View>
            <View className="min-w-0 flex-1">
              <CardTitle>USPS Form 1583 Verification</CardTitle>
              <CardDescription>
                Submit your notarized Form 1583, a government-issued photo ID, and a document
                confirming your home address.
              </CardDescription>
            </View>
          </View>
        </CardHeader>

        <CardContent className="gap-5 p-5 pt-0">
          <View className="gap-2 rounded-lg border border-border bg-background p-4">
            <View className="flex-row flex-wrap items-center gap-3">
              <Badge variant="outline" className={statusColor.container} labelClassName={statusColor.label}>
                {status}
              </Badge>
              {record?.submittedAt ? (
                <Text className="text-sm text-muted-foreground">Submitted {formatDate(record.submittedAt)}</Text>
              ) : null}
            </View>
            {record?.reviewNotes ? (
              <Text className="text-sm text-muted-foreground">Note from the center: {record.reviewNotes}</Text>
            ) : null}
          </View>

          <DocumentPickerField
            label="Notarized USPS Form 1583"
            required
            value={form1583}
            onChange={setForm1583}
          />

          <View className="gap-2">
            <DocumentPickerField
              label="Government-issued photo ID"
              required
              value={photoId}
              onChange={setPhotoId}
            />
            <Field label="Document type">
              <Input
                value={photoIdType}
                onChangeText={setPhotoIdType}
                placeholder="Driver's license, passport..."
              />
            </Field>
          </View>

          <View className="gap-2">
            <DocumentPickerField
              label="Proof of address"
              required
              value={addressId}
              onChange={setAddressId}
            />
            <Field label="Document type">
              <Input
                value={addressIdType}
                onChangeText={setAddressIdType}
                placeholder="Lease agreement, insurance policy..."
              />
            </Field>
          </View>

          <Text className="text-sm leading-5 text-muted-foreground">
            PDF, JPG, PNG or WEBP. Submitting again replaces the current paperwork and sends it
            back to the center for review.
          </Text>

          <Button
            icon={<Upload size={18} color={brand.primaryForeground} />}
            loading={submit.isPending}
            onPress={() => submit.mutate()}
          >
            Submit USPS documents
          </Button>
        </CardContent>
      </Card>
    </ScrollView>
  );
}
