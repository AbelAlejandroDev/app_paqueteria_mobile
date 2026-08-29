import { useMemo } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { router, Stack } from "expo-router";
import { ChevronRight } from "lucide-react-native";

import { useAuth } from "@/context/AuthContext";
import { formatAppVersion, formatTimeZone } from "@/lib/app-info";
import { Card } from "@/components/ui/card";

/**
 * Cada opcion abre su propia ruta. Nada se consulta desde aqui: los datos de
 * cada seccion se piden al entrar en ella, no al abrir Settings.
 */
const SECTIONS = [
  { label: "Forwarding Addresses", href: "/settings/forwarding-addresses" },
  { label: "Notifications", href: "/settings/notifications" },
  { label: "Authorized Individuals", href: "/settings/authorized-individuals" },
  { label: "USPS Verification", href: "/usps-verification" },
  { label: "Security", href: "/settings/security" },
];

function SectionRow({ label, href, last }) {
  return (
    <Pressable
      onPress={() => router.push(href)}
      className={
        last
          ? "flex-row items-center justify-between gap-4 px-5 py-4 active:bg-muted"
          : "flex-row items-center justify-between gap-4 border-b border-border px-5 py-4 active:bg-muted"
      }
    >
      <Text className="text-base font-medium text-foreground">{label}</Text>
      <ChevronRight size={20} color="#94a3b8" />
    </Pressable>
  );
}

export default function SettingsScreen() {
  const { user } = useAuth();
  const timeZone = useMemo(() => formatTimeZone(), []);

  const accountDetails = [
    // Antes se llamaba RTID, que no dice nada al cliente. Es su numero de
    // buzon, el mismo VO-7 que ve en Mail.
    { label: "Customer #", value: user?.clientContext?.mailboxCode || "Not assigned" },
    // "User" es la cuenta con la que entra, asi que el correo identifica mejor
    // que el nombre, que ya sale en el panel.
    { label: "User", value: user?.email || "Not assigned" },
    { label: "App Version", value: formatAppVersion() },
    { label: "Time Zone", value: timeZone },
  ];

  return (
    <>
      <Stack.Screen options={{ title: "Settings", headerTitleAlign: "center" }} />

      <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-6 p-4 pb-24">
        <Card>
          {SECTIONS.map((section, index) => (
            <SectionRow
              key={section.href}
              label={section.label}
              href={section.href}
              last={index === SECTIONS.length - 1}
            />
          ))}
        </Card>

        <Card>
          <View className="gap-3 p-5">
            {accountDetails.map((item) => (
              <View key={item.label} className="rounded-md border border-border bg-background p-4">
                <Text className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {item.label}
                </Text>
                <Text className="mt-2 text-sm font-semibold text-foreground">{item.value}</Text>
              </View>
            ))}
          </View>
        </Card>
      </ScrollView>
    </>
  );
}
