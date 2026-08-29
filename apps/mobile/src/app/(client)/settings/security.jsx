import { Alert, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { LogOut } from "lucide-react-native";

import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function SecurityScreen() {
  const { logout } = useAuth();

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
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-4 pb-24">
      <Card>
        <CardContent className="gap-4 p-5">
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
        </CardContent>
      </Card>
    </ScrollView>
  );
}
