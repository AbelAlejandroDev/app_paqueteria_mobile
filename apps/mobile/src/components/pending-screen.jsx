import { ScrollView, Text, View } from "react-native";

/**
 * Marcador temporal para las pantallas del portal de cliente que aún no se han
 * portado desde el front web. `source` apunta al fichero de origen.
 */
export default function PendingScreen({ title, source }) {
  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="p-6">
      <Text className="text-2xl font-semibold text-foreground">{title}</Text>
      <View className="mt-4 rounded-lg border border-border bg-card p-4">
        <Text className="text-sm leading-5 text-muted-foreground">
          Pendiente de portar desde el front web.
        </Text>
        <Text className="mt-2 font-mono text-xs text-muted-foreground">{source}</Text>
      </View>
    </ScrollView>
  );
}
