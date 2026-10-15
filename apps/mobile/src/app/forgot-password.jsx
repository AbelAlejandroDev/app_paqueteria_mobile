import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { CheckCircle2, Mail } from "lucide-react-native";

import BrandIdentity from "@/components/common/brand-identity";
import { INPUT_MIN_HEIGHT, inputTextStyle } from "@/components/ui/input";
import { api } from "@/lib/api";
import { brand } from "@/lib/brand";
import { forgotPasswordPayload, FORGOT_PASSWORD_SENT_MESSAGE, isValidEmail } from "@/lib/forgot-password";
import { cn, formatErrorMessage } from "@/lib/utils";

/**
 * "Olvide mi contrasena".
 *
 * El servidor (POST /auth/forgot-password) manda un enlace al correo si la
 * cuenta existe, y responde lo mismo exista o no: asi nadie puede usar esta
 * pantalla para averiguar que correos son clientes. Por eso aqui siempre se
 * muestra el mismo mensaje. El enlace abre el portal de miembros del centro del
 * cliente, donde elige la contrasena nueva.
 */
export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setError("");
    if (!isValidEmail(email)) {
      setError("Enter a valid email.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/auth/forgot-password", forgotPasswordPayload(email, brand.tenantSlug));
      setSent(true);
    } catch (err) {
      // 429: demasiadas peticiones; el servidor dice cuanto esperar.
      setError(formatErrorMessage(err, "We couldn't send the email. Try again in a few minutes."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView className="flex-1" behavior="padding">
        <ScrollView contentContainerClassName="flex-grow justify-center px-6 py-10" keyboardShouldPersistTaps="handled">
          <View className="rounded-lg border border-border bg-card p-6">
            <BrandIdentity centered className="mb-2" />
            <Text className="mb-6 text-center text-sm text-muted-foreground">Reset your password</Text>

            {sent ? (
              <View className="gap-4">
                <View className="flex-row gap-2 rounded-lg border border-border bg-muted p-3">
                  <CheckCircle2 size={18} color="#16a34a" />
                  <Text className="flex-1 text-sm leading-5 text-muted-foreground">{FORGOT_PASSWORD_SENT_MESSAGE}</Text>
                </View>
                <TouchableOpacity
                  className="items-center justify-center rounded-lg bg-primary px-4 py-2"
                  style={{ minHeight: INPUT_MIN_HEIGHT + 4 }}
                  onPress={() => router.replace("/login")}
                >
                  <Text className="text-base font-semibold text-primary-foreground">Back to sign in</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View className="gap-4">
                <Text className="text-sm leading-5 text-muted-foreground">
                  {"Enter the email you use to sign in. We'll send you a link to choose a new password."}
                </Text>
                <View
                  className={cn("flex-row items-center rounded-lg border bg-card px-3", error ? "border-destructive" : "border-input")}
                  style={{ minHeight: INPUT_MIN_HEIGHT + 4 }}
                >
                  <Mail size={18} color="#94a3b8" />
                  <TextInput
                    className="ml-2.5 flex-1 self-stretch text-base text-foreground"
                    style={inputTextStyle}
                    placeholder="Email"
                    placeholderTextColor="#94a3b8"
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                    textContentType="emailAddress"
                    onSubmitEditing={submit}
                  />
                </View>
                {error ? <Text className="text-center text-sm text-destructive">{error}</Text> : null}
                <TouchableOpacity
                  className={cn("mt-2 items-center justify-center rounded-lg bg-primary px-4 py-2", submitting && "opacity-60")}
                  style={{ minHeight: INPUT_MIN_HEIGHT + 4 }}
                  onPress={submit}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator color={brand.primaryForeground} />
                  ) : (
                    <Text className="text-base font-semibold text-primary-foreground">Send reset link</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity className="items-center py-2" onPress={() => router.back()} hitSlop={8}>
                  <Text className="text-sm text-muted-foreground">Back to sign in</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
