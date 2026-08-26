import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import Constants from "expo-constants";
import { ChevronDown, ChevronRight, FileCheck2, LogOut, MapPin, ShieldCheck, UserRound } from "lucide-react-native";
import { brand } from "@/lib/brand";

import { useAuth } from "@/context/AuthContext";
import PageTitle from "@/components/common/page-title";
import AuthorizedIndividualsPanel from "@/components/common/authorized-individuals-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function getProfileAddress(user) {
  const address = user?.clientProfile?.forwardingAddress || user?.forwardingAddress || user?.address || {};

  return {
    name: address.name || user?.name || "",
    address1: address.address1 || address.line1 || "",
    address2: address.address2 || address.line2 || "",
    city: address.city || "",
    state: address.state || "",
    zip: address.zip || address.postalCode || "",
    country: address.country || "US",
  };
}

function getUserLabel(user) {
  return user?.name || user?.fullName || user?.email || "Client account";
}

function getTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time";
  } catch (error) {
    return "Local time";
  }
}

function SettingsSection({ title, description, icon: Icon, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        className="flex-row items-center justify-between gap-4 border-b border-border px-5 py-4 active:bg-muted"
      >
        <View className="min-w-0 flex-1 flex-row items-center gap-3">
          <View className="h-10 w-10 items-center justify-center rounded-md bg-primary/10">
            <Icon size={20} color={brand.primaryColor} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-base font-semibold text-foreground">{title}</Text>
            <Text className="mt-1 text-sm text-muted-foreground">{description}</Text>
          </View>
        </View>
        <View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}>
          <ChevronDown size={20} color="#64748b" />
        </View>
      </Pressable>
      {open ? <CardContent className="p-5 pt-5">{children}</CardContent> : null}
    </Card>
  );
}

function AddressLine({ label, value }) {
  if (!value) return null;

  return (
    <View className="flex-row justify-between gap-4 py-1.5">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="flex-1 text-right text-sm font-medium text-foreground">{value}</Text>
    </View>
  );
}

export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const address = useMemo(() => getProfileAddress(user), [user]);
  const timeZone = useMemo(getTimeZone, []);
  const hasAddress = Boolean(address.address1 || address.city);

  const accountDetails = [
    { label: "Site ID", value: user?.siteId || user?.centerId || "Not assigned" },
    { label: "RTID", value: user?.rtid || user?.clientProfile?.rtid || "Not assigned" },
    { label: "User", value: getUserLabel(user) },
    { label: "App Version", value: Constants.expoConfig?.version || "1.0.0" },
    { label: "Timezone", value: timeZone },
  ];

  const confirmLogout = () => {
    Alert.alert("Cerrar sesión", "¿Seguro que quieres salir de tu cuenta?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Cerrar sesión",
        style: "destructive",
        onPress: async () => {
          await logout();
          router.replace("/login");
        },
      },
    ]);
  };

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-6 p-4 pb-24">
      <PageTitle title="Settings" subtitle="Dirección de reenvío, autorizados y datos de la cuenta." />

      <SettingsSection
        title="Forwarding Address"
        description="Dirección usada al reenviar tu correo."
        icon={MapPin}
      >
        {hasAddress ? (
          <View>
            <AddressLine label="Destinatario" value={address.name} />
            <AddressLine label="Dirección" value={address.address1} />
            <AddressLine label="Línea 2" value={address.address2} />
            <AddressLine label="Ciudad" value={address.city} />
            <AddressLine label="Estado" value={address.state} />
            <AddressLine label="ZIP" value={address.zip} />
            <AddressLine label="País" value={address.country} />
          </View>
        ) : (
          <Text className="text-sm text-muted-foreground">No hay dirección de reenvío registrada.</Text>
        )}
        <Text className="mt-4 text-sm leading-5 text-muted-foreground">
          Para modificarla, contacta con tu centro desde la pestaña Help.
        </Text>
      </SettingsSection>

      <SettingsSection
        title="Authorized Individuals"
        description="Personas que pueden recibir o recoger correo por ti."
        icon={UserRound}
      >
        <AuthorizedIndividualsPanel />
      </SettingsSection>

      {/* La verificación USPS no tiene pestaña propia; este es su único acceso. */}
      <Card>
        <Pressable
          onPress={() => router.push("/usps-verification")}
          className="flex-row items-center justify-between gap-4 px-5 py-4 active:bg-muted"
        >
          <View className="min-w-0 flex-1 flex-row items-center gap-3">
            <View className="h-10 w-10 items-center justify-center rounded-md bg-primary/10">
              <FileCheck2 size={20} color={brand.primaryColor} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-base font-semibold text-foreground">USPS Verification</Text>
              <Text className="mt-1 text-sm text-muted-foreground">
                Formulario 1583 y documentos de identidad.
              </Text>
            </View>
          </View>
          <ChevronRight size={20} color="#64748b" />
        </Pressable>
      </Card>

      <SettingsSection title="Security" description="Sesión de este dispositivo." icon={ShieldCheck}>
        <View className="gap-4">
          <Text className="text-sm leading-5 text-muted-foreground">
            Tu sesión se guarda cifrada en este dispositivo (Keychain en iOS, Keystore en Android) y se renueva
            sola mientras siga siendo válida.
          </Text>
          <Button
            variant="outline"
            className="border-rose-200"
            labelClassName="text-rose-700"
            icon={<LogOut size={18} color="#be123c" />}
            onPress={confirmLogout}
          >
            Cerrar sesión
          </Button>
        </View>
      </SettingsSection>

      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle>Account Details</CardTitle>
          <CardDescription>Información de referencia de esta cuenta.</CardDescription>
        </CardHeader>
        <CardContent className="gap-3 p-5 pt-5">
          {accountDetails.map((item) => (
            <View key={item.label} className="rounded-md border border-border bg-background p-4">
              <Text className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {item.label}
              </Text>
              <Text className="mt-2 text-sm font-semibold text-foreground">{item.value}</Text>
            </View>
          ))}
        </CardContent>
      </Card>
    </ScrollView>
  );
}
