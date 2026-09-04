import { useEffect, useState } from "react";
import { Alert, ScrollView, Switch, Text, View } from "react-native";

import { brand } from "@/lib/brand";
import {
  authenticate,
  getBiometricSupport,
  getSecurityPreferences,
  setSecurityPreferences,
} from "@/lib/security-preferences";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function SettingRow({ title, description, value, onValueChange, disabled }) {
  return (
    <View className="flex-row items-start justify-between gap-3">
      <View className="min-w-0 flex-1">
        <Text className="text-base font-medium text-foreground">{title}</Text>
        {description ? (
          <Text className="mt-1 text-sm leading-5 text-muted-foreground">{description}</Text>
        ) : null}
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ true: brand.primaryColor, false: "#cbd5e1" }}
        thumbColor="#ffffff"
      />
    </View>
  );
}

export default function SecurityScreen() {
  const [prefs, setPrefs] = useState(null);
  const [biometrics, setBiometrics] = useState(null);

  useEffect(() => {
    let active = true;

    (async () => {
      const [stored, support] = await Promise.all([getSecurityPreferences(), getBiometricSupport()]);
      if (!active) return;

      setPrefs(stored);
      setBiometrics(support);
    })();

    return () => {
      active = false;
    };
  }, []);

  if (!prefs || !biometrics) {
    return (
      <View className="flex-1 gap-4 bg-background p-4">
        <Skeleton className="h-32 w-full" />
      </View>
    );
  }

  const update = async (patch) => {
    const next = await setSecurityPreferences({ ...prefs, ...patch });
    setPrefs(next);
  };

  const toggleBiometrics = async (enabled) => {
    if (!enabled) {
      await update({ requireBiometrics: false });
      return;
    }

    // Se exige superar la comprobacion antes de activarla: si el lector no
    // funciona, activarla dejaria al cliente fuera de su propia app.
    const ok = await authenticate("Confirm to turn on the lock");
    if (!ok) {
      Alert.alert("Could not turn it on", "The biometric check was not completed.");
      return;
    }

    await update({ requireBiometrics: true });
  };

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-4 pb-24">
      <Card>
        <CardContent className="gap-5 p-5">
          <SettingRow
            title="Keep me logged in"
            description="Keeps your session when you close the app. If you turn it off, you will have to sign in every time."
            value={prefs.keepLoggedIn}
            onValueChange={(value) => update({ keepLoggedIn: value })}
          />

          <View className="h-px bg-border" />

          <SettingRow
            title={biometrics.available ? biometrics.label : "Biometric lock"}
            description={
              biometrics.available
                ? "Asks for your fingerprint or face when you open the app."
                : biometrics.reason
            }
            value={prefs.requireBiometrics}
            disabled={!biometrics.available}
            onValueChange={toggleBiometrics}
          />
        </CardContent>
      </Card>
    </ScrollView>
  );
}
