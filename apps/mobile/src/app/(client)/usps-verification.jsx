import { useState } from "react";
import { Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileCheck2, Mail, Upload } from "lucide-react-native";

import { api } from "@/lib/api";
import { brand } from "@/lib/brand";
import { formatDate, formatErrorMessage } from "@/lib/utils";
import {
  canShowUploadForm,
  handleSubmitError,
  resolveUspsView,
} from "@/lib/usps-compliance-state";
import DocumentPickerField from "@/components/common/document-picker-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const QUERY_KEY = ["client-usps-compliance"];

/**
 * Como se nombra cada estado del backend. No hay estados propios: si aqui se
 * inventara uno, la pantalla diria algo que el servidor no sabe. NOT_SUBMITTED
 * lo manda el backend cuando todavia no hay ningun envio.
 */
const SKY = { container: "border-sky-200 bg-sky-100", label: "text-sky-800" };
const NEUTRAL = { container: "border-slate-200 bg-slate-100", label: "text-slate-700" };

const STATUS = {
  NOT_SUBMITTED: { label: "Not submitted", tone: NEUTRAL, note: null },
  DRAFT: { label: "Not submitted", tone: NEUTRAL, note: null },
  SUBMITTED: {
    label: "Under review",
    tone: SKY,
    note: "Your documents were received. Your center will review them soon.",
  },
  UNDER_REVIEW: { label: "Under review", tone: SKY, note: "Your center is reviewing your documents." },
  REJECTED: {
    label: "Action required",
    tone: { container: "border-rose-200 bg-rose-100", label: "text-rose-800" },
    note: "Your documents were not accepted. Please review the note and submit them again.",
  },
  EXPIRED: {
    label: "Action required",
    tone: { container: "border-amber-200 bg-amber-100", label: "text-amber-800" },
    note: "Your USPS Form 1583 has expired. Please submit an updated form.",
  },
};

/** "September 13, 2026": una fecha, no una marca de tiempo con segundos. */
function formatFriendlyDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/**
 * Estado final: el 1583 esta aprobado y no queda nada por hacer.
 *
 * No hay ningun selector ni boton de envio, y no se montan: asi tampoco se
 * puede abrir la camara ni la galeria.
 */
function ApprovedState({ view }) {
  const approvedOn = view.approvedAt ? formatFriendlyDate(view.approvedAt) : null;
  const welcomeId = view.welcomeMessage?.notificationId;

  return (
    <Card className="border-emerald-200 bg-emerald-50">
      <CardContent className="items-center gap-4 p-6">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-emerald-600">
          <CheckCircle2 size={34} color="#ffffff" />
        </View>
        <Text className="text-center text-xl font-semibold text-emerald-950">USPS Form 1583 Approved</Text>
        <Text className="text-center text-sm leading-6 text-emerald-900">
          Your USPS Form 1583 has been approved. No additional documents are required.
        </Text>
        {approvedOn ? (
          <Text className="text-center text-xs text-emerald-800">Approved on {approvedOn}</Text>
        ) : null}

        {/* El mensaje de bienvenida ya existe en el servidor: se enlaza por su
            id, no se redacta ni se reconstruye aqui. */}
        {welcomeId ? (
          <Button
            variant="outline"
            className="mt-1 w-full"
            icon={<Mail size={18} color="#0f172a" />}
            onPress={() => router.push({ pathname: "/notifications/[id]", params: { id: String(welcomeId) } })}
          >
            Read your welcome message
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function UspsVerificationScreen() {
  const queryClient = useQueryClient();
  const [form1583, setForm1583] = useState(null);
  const [photoId, setPhotoId] = useState(null);
  const [addressId, setAddressId] = useState(null);
  const [photoIdType, setPhotoIdType] = useState("");
  const [addressIdType, setAddressIdType] = useState("");

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => (await api.get("/client/usps-compliance")).data,
  });

  const record = query.data?.record;
  const view = resolveUspsView(query.data);
  const showForm = canShowUploadForm(view);

  const clearSelection = () => {
    setForm1583(null);
    setPhotoId(null);
    setAddressId(null);
    setPhotoIdType("");
    setAddressIdType("");
  };

  const submit = useMutation({
    mutationFn: async () => {
      // Sin permiso del backend no se envia nada, aunque el boton llegara a pulsarse.
      if (!showForm) return null;
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
    onSuccess: (response) => {
      if (!response) return;
      Alert.alert("Documents submitted", "Your USPS paperwork is now under review.");
      clearSelection();
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    // Aprobado mientras el cliente preparaba los archivos: se descartan, se
    // recarga el estado real y la pantalla pasa sola a aprobado, sin alerta.
    onError: (error) =>
      handleSubmitError(error, {
        clearSelection,
        refetch: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
        showError: (err) => Alert.alert("Could not submit", formatErrorMessage(err)),
      }),
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

  const status = STATUS[view.status] || STATUS.NOT_SUBMITTED;

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-6 p-4 pb-24"
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={query.isFetching && !query.isLoading} onRefresh={query.refetch} />}
    >
      {view.approved ? (
        <ApprovedState view={view} />
      ) : (
        <Card>
          <CardHeader>
            <View className="flex-row items-start gap-3">
              <View className="rounded-xl bg-primary/10 p-3">
                <FileCheck2 size={24} color={brand.primaryColor} />
              </View>
              <View className="min-w-0 flex-1">
                <CardTitle>USPS Form 1583 Verification</CardTitle>
                {showForm ? (
                  <CardDescription>
                    Submit your notarized Form 1583, a government-issued photo ID, and a document
                    confirming your home address.
                  </CardDescription>
                ) : null}
              </View>
            </View>
          </CardHeader>

          <CardContent className="gap-5 p-5 pt-0">
            <View className="gap-2 rounded-lg border border-border bg-background p-4">
              <View className="flex-row flex-wrap items-center gap-3">
                <Badge variant="outline" className={status.tone.container} labelClassName={status.tone.label}>
                  {status.label}
                </Badge>
                {record?.submittedAt ? (
                  <Text className="text-sm text-muted-foreground">Submitted {formatDate(record.submittedAt)}</Text>
                ) : null}
              </View>
              {status.note ? <Text className="text-sm leading-5 text-foreground">{status.note}</Text> : null}
              {view.reviewReason ? (
                <Text className="text-sm text-muted-foreground">Note from the center: {view.reviewReason}</Text>
              ) : null}
            </View>

            {/* Sin permiso de subida no se monta nada que abra la camara o los
                archivos, aunque el estado no sea aprobado. */}
            {showForm ? (
              <>
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
              </>
            ) : null}
          </CardContent>
        </Card>
      )}
    </ScrollView>
  );
}
