import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Lock, ShieldCheck } from "lucide-react-native";
import {
  broadcastAuthUserUpdated,
  normalizeAuthUser,
  setAuthUser,
  setTokens,
} from "@paqueteria/core";

import { api } from "@/lib/api";
import { brand } from "@/lib/brand";
import { formatErrorMessage } from "@/lib/utils";
import BrandIdentity from "@/components/common/brand-identity";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const schema = z
  .object({
    password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres."),
    confirmPassword: z.string().min(1, "Confirma tu contraseña."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Las contraseñas no coinciden.",
    path: ["confirmPassword"],
  });

function PasswordField({ control, name, label, error }) {
  const [hidden, setHidden] = useState(true);

  return (
    <View className="gap-1.5">
      <Label>{label}</Label>
      <View
        className={cn(
          "h-12 flex-row items-center rounded-lg border bg-card px-3",
          error ? "border-destructive" : "border-input"
        )}
      >
        <Lock size={18} color="#94a3b8" />
        <Controller
          control={control}
          name={name}
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              className="ml-2.5 flex-1 text-base text-foreground"
              placeholder="••••••••"
              placeholderTextColor="#94a3b8"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              secureTextEntry={hidden}
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
            />
          )}
        />
        <Pressable onPress={() => setHidden((v) => !v)} hitSlop={10}>
          {hidden ? <EyeOff size={18} color="#94a3b8" /> : <Eye size={18} color="#94a3b8" />}
        </Pressable>
      </View>
      {error ? <Text className="ml-1 text-sm text-destructive">{error}</Text> : null}
    </View>
  );
}

function Shell({ children }) {
  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerClassName="flex-grow justify-center px-6 py-10"
          keyboardShouldPersistTaps="handled"
        >
          <View className="rounded-lg border border-border bg-card p-6">
            <BrandIdentity centered className="mb-6" />
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * Activación de cuenta. El token llega por el enlace del correo de alta, que
 * abre la app con el esquema propio de la marca:
 *
 *   worxclient://set-password?token=...
 *   hdgclient://set-password?token=...
 */
export default function SetPasswordScreen() {
  const params = useLocalSearchParams();
  const token = typeof params.token === "string" ? params.token.trim() : "";
  const [isSuccess, setIsSuccess] = useState(false);
  const [formError, setFormError] = useState("");

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const onSubmit = async (values) => {
    setFormError("");

    try {
      const response = await api.post("/auth/set-password", {
        token,
        newPassword: values.password,
      });

      const data = response.data || {};

      if (data.accessToken || data.refreshToken) {
        await setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
      }

      const nextUser = normalizeAuthUser(data.user || null, data);
      if (nextUser) {
        await setAuthUser(nextUser);
        broadcastAuthUserUpdated(nextUser);
      }

      setIsSuccess(true);
    } catch (error) {
      setFormError(formatErrorMessage(error, "No se pudo establecer la contraseña"));
    }
  };

  if (isSuccess) {
    return (
      <Shell>
        <View className="items-center gap-4 py-2">
          <View className="h-20 w-20 items-center justify-center rounded-full bg-emerald-100">
            <CheckCircle2 size={40} color="#059669" />
          </View>
          <Text className="text-xl font-bold text-foreground">Cuenta activada</Text>
          <Text className="text-center text-sm leading-6 text-muted-foreground">
            Tu contraseña se creó correctamente. Ya puedes entrar a tu buzón.
          </Text>
          <Button className="mt-2 w-full" onPress={() => router.replace("/")}>
            Continuar
          </Button>
        </View>
      </Shell>
    );
  }

  if (!token) {
    return (
      <Shell>
        <View className="items-center gap-4 py-2">
          <View className="h-20 w-20 items-center justify-center rounded-full bg-amber-100">
            <AlertCircle size={40} color="#b45309" />
          </View>
          <Text className="text-xl font-bold text-foreground">Enlace no válido</Text>
          <Text className="text-center text-sm leading-6 text-muted-foreground">
            Falta el token de activación o no es válido. Abre el enlace completo que recibiste por
            correo, o pide al centro que te lo reenvíe.
          </Text>
          <Button variant="outline" className="mt-2 w-full" onPress={() => router.replace("/login")}>
            Volver al acceso
          </Button>
        </View>
      </Shell>
    );
  }

  return (
    <Shell>
      <View className="gap-4">
        <View className="flex-row gap-3 rounded-lg border border-orange-200 bg-orange-50 p-4">
          <KeyRound size={20} color="#c2410c" />
          <Text className="flex-1 text-sm leading-5 text-orange-900">
            Crea una contraseña para tu cuenta usando este enlace seguro de activación.
          </Text>
        </View>

        <PasswordField
          control={control}
          name="password"
          label="Nueva contraseña"
          error={errors.password?.message}
        />
        <PasswordField
          control={control}
          name="confirmPassword"
          label="Confirmar contraseña"
          error={errors.confirmPassword?.message}
        />

        <View className="flex-row gap-3 rounded-lg bg-primary/10 p-3">
          <ShieldCheck size={20} color={brand.primaryColor} />
          <Text className="flex-1 text-xs leading-5 text-foreground">
            Este enlace es único para tu cuenta y puede caducar por seguridad.
          </Text>
        </View>

        {formError ? <Text className="text-center text-sm text-destructive">{formError}</Text> : null}

        <Button loading={isSubmitting} onPress={handleSubmit(onSubmit)}>
          Crear contraseña
        </Button>

        <Pressable
          className="flex-row items-center justify-center gap-2 pt-1"
          onPress={() => router.replace("/login")}
        >
          <ArrowLeft size={16} color="#64748b" />
          <Text className="text-sm font-medium text-muted-foreground">Volver al acceso</Text>
        </Pressable>
      </View>
    </Shell>
  );
}
