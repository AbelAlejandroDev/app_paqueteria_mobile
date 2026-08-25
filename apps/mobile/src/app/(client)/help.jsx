import { Linking, ScrollView, Text, View } from "react-native";
import { Mail, Phone } from "lucide-react-native";
import { getCurrentCenterName } from "@paqueteria/core";

import { useAuth } from "@/context/AuthContext";
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
          <Icon size={20} color="#65baaf" />
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

export default function HelpScreen() {
  const { user } = useAuth();
  const contact = getCenterContact(user);

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
            actionLabel="Enviar correo"
          />
          <ContactRow
            title="Support Phone"
            value={contact.supportPhone}
            icon={Phone}
            url={"tel:" + contact.supportPhone}
            actionLabel="Llamar"
            last
          />
        </CardContent>
      </Card>
    </ScrollView>
  );
}
