import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, ArrowLeft, Info, Mail, MailCheck, ShieldCheck } from "lucide-react-native";

import { api } from "@/lib/api";
import { brand } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { forgotPasswordOutcome } from "@/lib/auth-messages";
import BrandIdentity from "@/components/common/brand-identity";
import { Button } from "@/components/ui/button";
import { INPUT_MIN_HEIGHT, inputTextStyle } from "@/components/ui/input";

const { palette } = brand;

const schema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
});

/**
 * Espera entre envios. Evita que un toque repetido mande varios correos y
 * frena el uso de la pantalla para inundar un buzon ajeno; el limite de verdad
 * lo pone el backend.
 */
const RESEND_SECONDS = 60;

function Shell({ children }) {
  // Mismo criterio que login: margenes menores en telefonos de 360 dp.
  const compact = useWindowDimensions().width < 380;

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView className="flex-1" behavior="padding">
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

function BackToSignIn() {
  return (
    <Pressable
      className="flex-row items-center justify-center gap-2 pt-1 active:opacity-60"
      onPress={() => router.replace("/login")}
      accessibilityRole="link"
    >
      <ArrowLeft size={16} color={palette.glyph} />
      <Text className="font-hanken-semibold text-sm" style={{ color: palette.glyph }}>
        Back to sign in
      </Text>
    </Pressable>
  );
}

/**
 * Recuperar la contraseña.
 *
 * Se pide un enlace por correo; el enlace abre set-password con el token, la
 * misma pantalla de la activacion. La respuesta es la misma exista o no la
 * cuenta, para no revelar que correos estan dados de alta.
 */
export default function ForgotPasswordScreen() {
  const [outcome, setOutcome] = useState(null);
  const [cooldown, setCooldown] = useState(0);

  const {
    control,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema), defaultValues: { email: "" } });

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const send = async ({ email }) => {
    if (cooldown > 0) return;

    try {
      await api.post("/auth/forgot-password", {
        email: email.trim().toLowerCase(),
        // El backend busca la cuenta dentro de la marca de esta app.
        tenantSlug: brand.tenantSlug,
      });
      setOutcome(forgotPasswordOutcome(null));
      setCooldown(RESEND_SECONDS);
    } catch (error) {
      const result = forgotPasswordOutcome(error);
      setOutcome(result);
      // Con 429 el backend dice cuanto esperar: el boton queda apagado ese
      // tiempo, no solo el minuto de cortesia.
      if (result.retryAfter) setCooldown(result.retryAfter);
      else if (result.kind !== "error") setCooldown(RESEND_SECONDS);
    }
  };

  /** "45s" o "12:30": una espera de un 429 puede ser de casi una hora. */
  const waitLabel = cooldown >= 60
    ? Math.floor(cooldown / 60) + ":" + String(cooldown % 60).padStart(2, "0")
    : cooldown + "s";

  if (outcome?.kind === "sent") {
    return (
      <Shell>
        <View className="items-center gap-4 py-2">
          <View
            className="h-20 w-20 items-center justify-center rounded-full"
            style={{ backgroundColor: palette.tint + "66" }}
          >
            <MailCheck size={38} color={palette.glyph} />
          </View>
          <Text className="text-center font-hanken-bold text-xl text-foreground">Check your email</Text>
          <Text className="text-center font-hanken text-sm leading-6 text-muted-foreground">{outcome.message}</Text>
          <Text className="text-center font-hanken-semibold text-sm text-foreground">{getValues("email")}</Text>

          {/* Como funciona el enlace, segun el backend: se abre en el
              navegador, caduca en 60 minutos y pedir otro anula el anterior. */}
          <View className="w-full gap-2 rounded-xl p-3" style={{ backgroundColor: palette.tint + "40" }}>
            {[
              "The link opens in your browser and expires in 60 minutes.",
              "If you request another one, only the newest link will work.",
              "After you set your new password, come back here and sign in with it.",
            ].map((line) => (
              <View key={line} className="flex-row gap-2">
                <View className="mt-[7px] h-1.5 w-1.5 rounded-full" style={{ backgroundColor: palette.glyph }} />
                <Text className="flex-1 font-hanken text-xs leading-5 text-foreground">{line}</Text>
              </View>
            ))}
          </View>

          <Button
            variant="outline"
            className="mt-2 w-full"
            disabled={cooldown > 0 || isSubmitting}
            loading={isSubmitting}
            onPress={handleSubmit(send)}
          >
            {cooldown > 0 ? `Resend link in ${waitLabel}` : "Resend link"}
          </Button>
          <BackToSignIn />
        </View>
      </Shell>
    );
  }

  if (outcome?.kind === "unavailable") {
    return (
      <Shell>
        <View className="items-center gap-4 py-2">
          <View className="h-20 w-20 items-center justify-center rounded-full bg-amber-100">
            <Info size={38} color="#B45309" />
          </View>
          <Text className="text-center font-hanken-bold text-xl text-foreground">Contact your center</Text>
          <Text className="text-center font-hanken text-sm leading-6 text-muted-foreground">{outcome.message}</Text>
          <BackToSignIn />
        </View>
      </Shell>
    );
  }

  return (
    <Shell>
      <View className="gap-4">
        <View className="gap-1.5">
          <Text className="text-center font-hanken-bold text-xl text-foreground">Forgot your password?</Text>
          <Text className="text-center font-hanken text-sm leading-6 text-muted-foreground">
            {"Enter the email you use to sign in and we'll send you a link to create a new password."}
          </Text>
        </View>

        <View className="gap-1.5">
          <View
            className={cn(
              "flex-row items-center rounded-[10px] border bg-card px-3",
              errors.email ? "border-destructive" : "border-input"
            )}
            style={{ minHeight: INPUT_MIN_HEIGHT + 4 }}
          >
            <Mail size={18} color="#A3A19E" />
            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  className="ml-2.5 flex-1 self-stretch font-hanken text-base text-foreground"
                  style={inputTextStyle}
                  placeholder="Email"
                  placeholderTextColor="#A3A19E"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  textContentType="emailAddress"
                  returnKeyType="send"
                  onSubmitEditing={handleSubmit(send)}
                />
              )}
            />
          </View>
          {errors.email ? (
            <Text className="ml-1 font-hanken text-sm text-destructive">{errors.email.message}</Text>
          ) : null}
        </View>

        {outcome?.kind === "error" ? (
          <View className="flex-row gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3" accessibilityRole="alert">
            <AlertCircle size={18} color="#BE123C" />
            <Text className="flex-1 font-hanken-semibold text-sm leading-5 text-rose-800">{outcome.message}</Text>
          </View>
        ) : null}

        <Button loading={isSubmitting} disabled={cooldown > 0} onPress={handleSubmit(send)}>
          {cooldown > 0 ? `Try again in ${waitLabel}` : "Send reset link"}
        </Button>

        <View className="flex-row gap-3 rounded-xl p-3" style={{ backgroundColor: palette.tint + "40" }}>
          <ShieldCheck size={20} color={palette.glyph} />
          <Text className="flex-1 font-hanken text-xs leading-5 text-foreground">
            For your security, the link works only once and expires in 60 minutes. We never ask for your
            password by email or phone.
          </Text>
        </View>

        {/* El personal del centro no recibe este correo (el backend responde
            igual a todos): su camino es el administrador. */}
        <Text className="text-center font-hanken text-xs leading-5 text-muted-foreground">
          Are you center staff? Ask your administrator to send you a reset link.
        </Text>

        <BackToSignIn />
      </View>
    </Shell>
  );
}
