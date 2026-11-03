import { useMemo } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { router, Stack } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Bell, CalendarX, ChevronRight, ExternalLink, FileText, GraduationCap, Lock, LockKeyhole, LogOut, MapPin, Receipt, ShieldCheck, Trash2, UsersRound } from "lucide-react-native";

import { useAuth } from "@/context/AuthContext";
import { brand } from "@/lib/brand";
import { overWhite } from "@/lib/colors";
import { formatAppVersion, formatTimeZone } from "@/lib/app-info";
import { privacyPolicyFor } from "@/lib/legal-links";
import { formatStatusDisplay } from "@/lib/mail-item-display";
import { CardHeading, DetailCard, DetailRow, MailboxChip } from "@/components/common/mail-item-detail-ui";
import { useOnboarding } from "@/components/onboarding/onboarding-provider";

const { palette } = brand;

/**
 * Cada opcion abre su propia ruta. Nada se consulta desde aqui: los datos de
 * cada seccion se piden al entrar en ella, no al abrir Settings.
 */
const SECTIONS = [
  { label: "Forwarding Addresses", href: "/settings/forwarding-addresses", icon: MapPin },
  { label: "Notifications", href: "/settings/notifications", icon: Bell },
  { label: "Authorized Individuals", href: "/settings/authorized-individuals", icon: UsersRound },
  { label: "USPS Verification", href: "/usps-verification", icon: ShieldCheck },
  { label: "Security", href: "/settings/security", icon: LockKeyhole },
  { label: "Terms & Conditions", href: "/settings/terms", icon: FileText },
  { label: "Fee Schedule", href: "/settings/fee-schedule", icon: Receipt },
  // No es una ruta: vuelve a abrir la bienvenida y el recorrido.
  { label: "App Tutorial", action: "replayTutorial", icon: GraduationCap },
];

/**
 * Membership & Account: dar de baja la membresia (la misma tarjeta que en
 * Billing → Payment, que sigue alli) y pedir el borrado de la cuenta, que es
 * otra cosa y va aparte. Google Play pide que borrar la cuenta se encuentre
 * facil.
 */
const ACCOUNT_SECTIONS = [
  { label: "Cancel Membership", href: "/settings/membership", icon: CalendarX },
  { label: "Delete Account", href: "/settings/delete-account", icon: Trash2, danger: true },
];

/** Una seccion: icono en el cuadro verde de marca, nombre y flecha, como las tarjetas del panel. */
function SectionRow({ label, href, icon: Icon, last, onPress, danger = false, external = false }) {
  return (
    <Pressable
      onPress={onPress || (() => router.push(href))}
      accessibilityRole="button"
      className={
        last
          ? "flex-row items-center gap-3.5 px-4 py-3.5 active:bg-tint/20"
          : "flex-row items-center gap-3.5 border-b border-border px-4 py-3.5 active:bg-tint/20"
      }
    >
      {/* Borrar la cuenta en rojo, como Sign out: se distingue de un vistazo
          de cancelar la membresia. */}
      <View
        className="h-10 w-10 items-center justify-center rounded-[10px]"
        style={{ backgroundColor: danger ? "#FFF1F2" : overWhite(palette.tint, 0.4) }}
      >
        <Icon size={20} color={danger ? "#BE123C" : palette.glyph} />
      </View>
      <Text className={`min-w-0 flex-1 font-brand-bold text-[16px] ${danger ? "text-rose-700" : "text-ink"}`}>{label}</Text>
      {/* Lo que sale de la app lleva el mismo icono que Conference Room en el panel. */}
      {external ? <ExternalLink size={17} color={palette.ink} /> : <ChevronRight size={20} color={palette.ink} />}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const { replay } = useOnboarding();
  const timeZone = useMemo(() => formatTimeZone(), []);
  // De la organizacion del usuario: HDG no hereda la de The Worx.
  const privacyPolicy = privacyPolicyFor(user?.tenant?.slug);

  const confirmLogout = () => {
    Alert.alert("Sign out", "Are you sure you want to leave your account?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          await logout();
          router.replace("/login");
        },
      },
    ]);
  };

  const accountDetails = [
    // Antes se llamaba RTID, que no dice nada al cliente. Es su numero de
    // buzon, el mismo VO-7 que ve en Mail.
    { label: "Customer #", value: user?.clientContext?.mailboxCode || "Not assigned" },
    // "User" es la cuenta con la que entra, asi que el correo identifica mejor
    // que el nombre, que ya sale en el panel.
    { label: "User", value: user?.email || "Not assigned" },
    // El plan sale de /auth/me, que Settings ya tiene cargado: no hace falta
    // consultar facturacion para decir algo que el cliente pregunta aqui.
    {
      label: "Plan",
      value: user?.clientContext?.servicePlan
        ? formatStatusDisplay(user.clientContext.servicePlan)
        : "Not assigned",
    },
    { label: "App", value: brand.appName || brand.name },
    { label: "App Version", value: formatAppVersion() },
    { label: "Time Zone", value: timeZone },
  ];

  return (
    <>
      <Stack.Screen options={{ title: "Settings", headerTitleAlign: "center" }} />

      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="gap-5 p-4 pb-24">
        <DetailCard>
          {SECTIONS.map((section, index) => (
            <SectionRow
              key={section.href || section.action}
              label={section.label}
              href={section.href}
              icon={section.icon}
              onPress={section.action === "replayTutorial" ? replay : undefined}
              last={index === SECTIONS.length - 1}
            />
          ))}
        </DetailCard>

        <View className="gap-2">
          <Text className="px-1 font-brand-bold text-[13px] uppercase tracking-[0.12em] text-ink/60">Membership & Account</Text>
          <DetailCard>
            {ACCOUNT_SECTIONS.map((section, index) => (
              <SectionRow
                key={section.href}
                label={section.label}
                href={section.href}
                icon={section.icon}
                danger={section.danger}
                last={index === ACCOUNT_SECTIONS.length - 1}
              />
            ))}
          </DetailCard>
        </View>

        {/* Legal: la Privacy Policy se publica y se mantiene en la web de la
            organizacion; aqui solo se abre, en el navegador del sistema. */}
        {privacyPolicy ? (
          <View className="gap-2">
            <Text className="px-1 font-brand-bold text-[13px] uppercase tracking-[0.12em] text-ink/60">Legal</Text>
            <DetailCard>
              <SectionRow
                label="Privacy Policy"
                icon={Lock}
                external
                onPress={() => WebBrowser.openBrowserAsync(privacyPolicy.url)}
                last
              />
            </DetailCard>
          </View>
        ) : null}

        {/* Cerrar sesion vivia en Security, que ahora solo guarda ajustes.
            Va aparte porque es una accion, no una preferencia. */}
        <DetailCard>
          <Pressable onPress={confirmLogout} className="flex-row items-center gap-3.5 px-4 py-3.5 active:bg-rose-50">
            <View className="h-10 w-10 items-center justify-center rounded-[10px] bg-rose-50">
              <LogOut size={20} color="#BE123C" />
            </View>
            <Text className="min-w-0 flex-1 font-brand-bold text-[16px] text-rose-700">Sign out</Text>
          </Pressable>
        </DetailCard>

        {/* Los datos de la cuenta, en filas como los del item. El numero de
            cliente es su buzon, asi que va en el mismo chip que en el resto. */}
        <DetailCard className="px-5 pb-2 pt-5">
          <CardHeading className="mb-1">Account</CardHeading>
          {accountDetails.map((item, index) =>
            item.label === "Customer #" && item.value !== "Not assigned" ? (
              <DetailRow key={item.label} label={item.label}>
                <MailboxChip>{item.value}</MailboxChip>
              </DetailRow>
            ) : (
              <DetailRow key={item.label} label={item.label} value={item.value} last={index === accountDetails.length - 1} />
            )
          )}
        </DetailCard>
      </ScrollView>
    </>
  );
}
