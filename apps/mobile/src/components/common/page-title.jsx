import { Text, View } from "react-native";

export default function PageTitle({ title, subtitle, actions = null }) {
  return (
    <View className="gap-2">
      <Text className="text-2xl font-semibold tracking-tight text-foreground">{title}</Text>
      {subtitle ? <Text className="text-sm leading-5 text-muted-foreground">{subtitle}</Text> : null}
      {actions}
    </View>
  );
}
