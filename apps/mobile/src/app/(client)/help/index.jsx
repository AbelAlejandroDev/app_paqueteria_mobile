import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { ChevronRight, ExternalLink, FileText, Lock, Mail, Phone, Receipt } from "lucide-react-native";
import * as WebBrowser from "expo-web-browser";
import { getCurrentCenterName } from "@paqueteria/core";
import { brand } from "@/lib/brand";
import { overWhite } from "@/lib/colors";

import { useAuth } from "@/context/AuthContext";
import { usePrivacyPolicy } from "@/lib/use-privacy-policy";
import PageTitle from "@/components/common/page-title";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

function firstValue(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

function getCenterContact(user) {
  const center =
    user?.center ||
    user?.staffProfile?.center ||
    user?.clientProfile?.center ||
    user?.clientProfile?.mailbox?.center ||
    user?.mailbox?.center ||
    user?.location ||
    user?.branch ||
    {};
  const branding = user?.branding || {};
  const profile = user?.clientProfile || {};

  return {
    centerName:
      getCurrentCenterName(user) ||
      firstValue(center.name, center.companyName, center.company, branding.brandingName, branding.name) ||
      "Your mailbox center",
    supportEmail: firstValue(
      center.supportEmail,
      center.renterSupportEmail,
      center.contactEmail,
      center.email,
      branding.supportEmail,
      branding.renterSupportEmail,
      profile.supportEmail,
      user?.supportEmail
    ),
    supportPhone: firstValue(
      center.supportPhone,
      center.renterSupportPhone,
      center.contactPhone,
      center.phone,
      branding.supportPhone,
      branding.renterSupportPhone,
      profile.supportPhone,
      user?.supportPhone
    ),
  };
}

function ContactRow({ title, value, icon: Icon, url, actionLabel, last = false }) {
  const hasValue = Boolean(value);

  return (
    <View className={last ? "gap-3 py-5" : "gap-3 border-b border-border py-5"}>
      <View className="flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-md bg-primary/10">
          <Icon size={20} color={brand.primaryColor} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-sm font-semibold text-muted-foreground">{title}</Text>
          <Text className="text-base font-semibold text-foreground">
            {hasValue ? value : "Not configured yet"}
          </Text>
        </View>
      </View>
      <Button
        variant="outline"
        disabled={!hasValue}
        onPress={() => Linking.openURL(url)}
      >
        {actionLabel}
      </Button>
    </View>
  );
}

/**
 * Un documento del centro: icono en el cuadro de marca, nombre y flecha, igual
 * que las filas de Settings. Abre la pantalla dentro del Stack de Help.
 */
function DocumentRow({ label, description, href, onPress, icon: Icon, external = false, last = false }) {
  return (
    <Pressable
      onPress={onPress || (() => router.push(href))}
      accessibilityRole={external ? "link" : "button"}
      className={
        last
          ? "flex-row items-center gap-3.5 px-4 py-3.5 active:bg-tint/20"
          : "flex-row items-center gap-3.5 border-b border-border px-4 py-3.5 active:bg-tint/20"
      }
    >
      <View
        className="h-10 w-10 items-center justify-center rounded-[10px]"
        style={{ backgroundColor: overWhite(brand.palette.tint, 0.4) }}
      >
        <Icon size={20} color={brand.palette.glyph} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="font-brand-bold text-[16px] text-ink">{label}</Text>
        <Text className="font-brand text-[13px] leading-5 text-ink/60">{description}</Text>
      </View>
      {external ? <ExternalLink size={17} color={brand.palette.ink} /> : <ChevronRight size={20} color={brand.palette.ink} />}
    </Pressable>
  );
}

export default function HelpScreen() {
  const { user } = useAuth();
  const contact = getCenterContact(user);
  const privacyPolicy = usePrivacyPolicy();

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-6 p-4 pb-24">
      <PageTitle title="Virtual Mailbox Support" subtitle="Contact your mailbox center for help." />

      <Card>
        <CardContent className="p-5 pt-5">
          <View className="border-b border-border pb-5">
            <Text className="text-sm font-semibold text-muted-foreground">Center</Text>
            <Text className="mt-1 text-lg font-semibold text-foreground">{contact.centerName}</Text>
          </View>

          <ContactRow
            title="Support Email"
            value={contact.supportEmail}
            icon={Mail}
            url={"mailto:" + contact.supportEmail}
            actionLabel="Send email"
          />
          <ContactRow
            title="Support Phone"
            value={contact.supportPhone}
            icon={Phone}
            url={"tel:" + contact.supportPhone}
            actionLabel="Call"
            last
          />
        </CardContent>
      </Card>

      {/* Los documentos del centro, los mismos que en Settings. */}
      <Card>
        <CardContent className="p-0">
          <Text className="px-4 pb-1 pt-4 font-brand-bold text-[11px] uppercase tracking-wider text-ink/60">
            Documents
          </Text>
          <DocumentRow
            label="Terms & Conditions"
            description="The current terms of your mailbox center."
            href="/help/terms"
            icon={FileText}
          />
          <DocumentRow
            label="Fee Schedule"
            description="Your center's fees for services."
            href="/help/fee-schedule"
            icon={Receipt}
            last={!privacyPolicy}
          />
          {/* La misma politica que Settings → Legal (lib/use-privacy-policy):
              ni una URL repetida aqui ni la de otra organizacion. */}
          {privacyPolicy ? (
            <DocumentRow
              label="Privacy Policy"
              description="How your information is collected, used and protected."
              onPress={() => WebBrowser.openBrowserAsync(privacyPolicy.url)}
              icon={Lock}
              external
              last
            />
          ) : null}
        </CardContent>
      </Card>
    </ScrollView>
  );
}
