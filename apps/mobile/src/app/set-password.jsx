import { useState } from "react";
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
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
import { PASSWORD_MAX, PASSWORD_MIN, passwordProblem } from "@/lib/auth-messages";
import BrandIdentity from "@/components/common/brand-identity";
import { Button } from "@/components/ui/button";
import { INPUT_MIN_HEIGHT, Label, inputTextStyle } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const { palette } = brand;

/** Las reglas de la contraseña nueva, con el correo del enlace si viene. */
function buildSchema(email) {
  return z
    .object({
      password: z.string(),
      confirmPassword: z.string().min(1, "Confirm your password."),
    })
    .superRefine((data, context) => {
      const problem = passwordProblem(data.password, email);
      if (problem) context.addIssue({ code: "custom", message: problem, path: ["password"] });
      if (data.password !== data.confirmPassword) {
        context.addIssue({ code: "custom", message: "Passwords do not match.", path: ["confirmPassword"] });
      }
    });
}

function PasswordField({ control, name, label, error }) {
  const [hidden, setHidden] = useState(true);

  return (
    <View className="gap-1.5">
      <Label>{label}</Label>
      <View
        className={cn(
          "flex-row items-center rounded-[10px] border bg-card px-3",
          error ? "border-destructive" : "border-input"
        )}
        style={{ minHeight: INPUT_MIN_HEIGHT + 4 }}
      >
        <Lock size={18} color="#A3A19E" />
        <Controller
          control={control}
          name={name}
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              className="ml-2.5 flex-1 self-stretch font-hanken text-base text-foreground"
              style={inputTextStyle}
              placeholder="••••••••"
              placeholderTextColor="#A3A19E"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              secureTextEntry={hidden}
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              maxLength={PASSWORD_MAX}
            />
          )}
        />
        <Pressable onPress={() => setHidden((v) => !v)} hitSlop={10}>
          {hidden ? <EyeOff size={18} color="#A3A19E" /> : <Eye size={18} color="#A3A19E" />}
        </Pressable>
      </View>
      {error ? <Text className="ml-1 font-hanken text-sm text-destructive">{error}</Text> : null}
    </View>
  );
}

function Shell({ children }) {
  // Mismo criterio que login: margenes menores en telefonos de 360 dp.
  const compact = useWindowDimensions().width < 380;

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView className="flex-1" // Tambien en Android: con edge-to-edge la ventana ya no se encoge sola al
        // abrir el teclado, y en un telefono de 800 dp tapaba password y Sign in.
        behavior="padding">
        <ScrollView
          contentContainerClassName={cn("flex-grow justify-center", compact ? "px-4 py-6" : "px-6 py-10")}
          keyboardShouldPersistTaps="handled"
        >
          <View
            className={cn("rounded-2xl border border-border bg-card", compact ? "px-5 py-6" : "p-6")}
            style={{ shadowColor: "#1D4E4A", shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 3 }, elevation: 2 }}
          >
            <BrandIdentity centered className="mb-6" />
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * Activación de cuenta y restablecimiento de contraseña. El token llega por el
 * enlace del correo, que abre la app con el esquema propio de la marca:
 *
 *   worxclient://set-password?token=...              (alta)
 *   worxclient://set-password?token=...&mode=reset   (olvide mi contraseña)
 *
 * Es el mismo POST /auth/set-password en los dos casos; solo cambia el texto.
 */
export default function SetPasswordScreen() {
  const params = useLocalSearchParams();
  const token = typeof params.token === "string" ? params.token.trim() : "";
  const email = typeof params.email === "string" ? params.email.trim() : "";
  const isReset = params.mode === "reset";
  const [isSuccess, setIsSuccess] = useState(false);
  const [formError, setFormError] = useState("");
  const [linkExpired, setLinkExpired] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(buildSchema(email)),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const onSubmit = async (values) => {
    setFormError("");
    setLinkExpired(false);

    try {
      const response = await api.post("/auth/set-password", {
        token,
        newPassword: values.password,
        ...(email ? { email } : {}),
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
      // El backend responde "Invalid or expired token" sin distinguir: se dice
      // que hacer en vez de enseñar el texto tecnico.
      const expired =
        error?.response?.status === 400 && /token/i.test(String(error?.response?.data?.error || ""));
      setLinkExpired(expired);
      setFormError(
        expired
          ? "This link is invalid or has expired. Request a new one and try again."
          : formatErrorMessage(error, "Unable to set your password")
      );
    }
  };

  if (isSuccess) {
    return (
      <Shell>
        <View className="items-center gap-4 py-2">
          <View className="h-20 w-20 items-center justify-center rounded-full bg-emerald-100">
            <CheckCircle2 size={40} color="#059669" />
          </View>
          <Text className="font-hanken-bold text-xl text-foreground">
            {isReset ? "Password updated" : "Account activated"}
          </Text>
          <Text className="text-center font-hanken text-sm leading-6 text-muted-foreground">
            {isReset
              ? "Your new password is set. Use it the next time you sign in."
              : "Your password was created. You can now sign in to your mailbox."}
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
          <Text className="font-hanken-bold text-xl text-foreground">Invalid link</Text>
          <Text className="text-center font-hanken text-sm leading-6 text-muted-foreground">
            {isReset
              ? "This reset link is missing or incomplete. Open the full link from your email, or request a new one."
              : "The activation token is missing or invalid. Open the full link you received by email, or ask your center to send it again."}
          </Text>
          {isReset ? (
            <Button className="mt-2 w-full" onPress={() => router.replace("/forgot-password")}>
              Request a new link
            </Button>
          ) : null}
          <Button variant="outline" className="w-full" onPress={() => router.replace("/login")}>
            Back to sign in
          </Button>
        </View>
      </Shell>
    );
  }

  return (
    <Shell>
      <View className="gap-4">
        <View className="flex-row gap-3 rounded-xl border border-orange-200 bg-orange-50 p-4">
          <KeyRound size={20} color="#c2410c" />
          <Text className="flex-1 font-hanken text-sm leading-5 text-orange-900">
            {isReset
              ? "Choose a new password for your account."
              : "Create a password for your account using this secure activation link."}
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

        <View className="flex-row gap-3 rounded-xl p-3" style={{ backgroundColor: palette.tint + "40" }}>
          <ShieldCheck size={20} color={palette.glyph} />
          <Text className="flex-1 font-hanken text-xs leading-5 text-foreground">
            {"At least " +
              PASSWORD_MIN +
              " characters, with a letter and a number. This link is unique to your account and expires for security reasons."}
          </Text>
        </View>

        {formError ? (
          <View className="gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3" accessibilityRole="alert">
            <Text className="font-hanken-semibold text-sm leading-5 text-rose-800">{formError}</Text>
            {linkExpired ? (
              <Pressable onPress={() => router.replace("/forgot-password")} accessibilityRole="link">
                <Text className="font-hanken-bold text-sm text-rose-800 underline">Request a new link</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <Button loading={isSubmitting} onPress={handleSubmit(onSubmit)}>
          {isReset ? "Save new password" : "Create password"}
        </Button>

        <Pressable
          className="flex-row items-center justify-center gap-2 pt-1"
          onPress={() => router.replace("/login")}
        >
          <ArrowLeft size={16} color={palette.glyph} />
          <Text className="font-hanken-semibold text-sm" style={{ color: palette.glyph }}>
            Back to sign in
          </Text>
        </Pressable>
      </View>
    </Shell>
  );
}
