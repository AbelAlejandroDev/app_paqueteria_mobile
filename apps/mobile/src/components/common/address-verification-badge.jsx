import { Text, View } from "react-native";
import { BadgeCheck, ShieldAlert } from "lucide-react-native";

import { describeAddressVerification } from "@/lib/address-verification";

// Con icono y texto, no solo color.
const BADGE_TONES = {
  ok: { container: "border-emerald-200 bg-emerald-50", text: "text-emerald-800", color: "#047857", icon: BadgeCheck },
  warning: { container: "border-amber-200 bg-amber-50", text: "text-amber-900", color: "#92400e", icon: ShieldAlert },
  error: { container: "border-rose-200 bg-rose-50", text: "text-rose-800", color: "#be123c", icon: ShieldAlert },
};

export default function AddressVerificationBadge({ verification }) {
  const meta = describeAddressVerification(verification);
  const tone = BADGE_TONES[meta.tone];
  const Icon = tone.icon;

  return (
    <View className={"flex-row items-center gap-1 rounded-full border px-2 py-0.5 " + tone.container}>
      <Icon size={13} color={tone.color} />
      <Text className={"text-xs font-semibold " + tone.text}>{meta.label}</Text>
    </View>
  );
}
