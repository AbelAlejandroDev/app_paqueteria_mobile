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
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string().min(1, "Confirm your password."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
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
      setFormError(formatErrorMessage(error, "Unable to set your password"));
    }
  };

  if (isSuccess) {
    return (
      <Shell>
        <View className="items-center gap-4 py-2">
          <View className="h-20 w-20 items-center justify-center rounded-full bg-emerald-100">
            <CheckCircle2 size={40} color="#059669" />
          </View>
          <Text className="text-xl font-bold text-foreground">Account activated</Text>
          <Text className="text-center text-sm leading-6 text-muted-foreground">
            Your password was created. You can now sign in to your mailbox.
          </Text>
          <Button className="mt-2 w-full" onPress={() => router.replace("/")}>
            Continue
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
          <Text className="text-xl font-bold text-foreground">Invalid link</Text>
          <Text className="text-center text-sm leading-6 text-muted-foreground">
            The activation token is missing or invalid. Open the full link you received by email,
            or ask your center to send it again.
          </Text>
          <Button variant="outline" className="mt-2 w-full" onPress={() => router.replace("/login")}>
            Back to sign in
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
            Create a password for your account using this secure activation link.
          </Text>
        </View>

        <PasswordField
          control={control}
          name="password"
          label="New password"
          error={errors.password?.message}
        />
        <PasswordField
          control={control}
          name="confirmPassword"
          label="Confirm password"
          error={errors.confirmPassword?.message}
        />

        <View className="flex-row gap-3 rounded-lg bg-primary/10 p-3">
          <ShieldCheck size={20} color={brand.primaryColor} />
          <Text className="flex-1 text-xs leading-5 text-foreground">
            This link is unique to your account and may expire for security reasons.
          </Text>
        </View>

        {formError ? <Text className="text-center text-sm text-destructive">{formError}</Text> : null}

        <Button loading={isSubmitting} onPress={handleSubmit(onSubmit)}>
          Create password
        </Button>

        <Pressable
          className="flex-row items-center justify-center gap-2 pt-1"
          onPress={() => router.replace("/login")}
        >
          <ArrowLeft size={16} color="#64748b" />
          <Text className="text-sm font-medium text-muted-foreground">Back to sign in</Text>
        </Pressable>
      </View>
    </Shell>
  );
}
