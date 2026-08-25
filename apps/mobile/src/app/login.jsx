import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, Eye, EyeOff, Lock, Mail } from "lucide-react-native";

import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

const loginSchema = z.object({
  email: z.string().email("Enter a valid email."),
  password: z.string().min(1, "Password is required."),
});

function Field({ control, name, placeholder, icon: Icon, error, secure, ...inputProps }) {
  const [hidden, setHidden] = useState(!!secure);

  return (
    <View className="gap-1.5">
      <View
        className={cn(
          "h-12 flex-row items-center rounded-lg border bg-card px-3",
          error ? "border-destructive" : "border-input"
        )}
      >
        <Icon size={18} color="#94a3b8" />
        <Controller
          control={control}
          name={name}
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              className="ml-2.5 flex-1 text-base text-foreground"
              placeholder={placeholder}
              placeholderTextColor="#94a3b8"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              secureTextEntry={hidden}
              {...inputProps}
            />
          )}
        />
        {secure ? (
          <TouchableOpacity onPress={() => setHidden((v) => !v)} hitSlop={10}>
            {hidden ? <EyeOff size={18} color="#94a3b8" /> : <Eye size={18} color="#94a3b8" />}
          </TouchableOpacity>
        ) : null}
      </View>
      {error ? <Text className="ml-1 text-sm text-destructive">{error}</Text> : null}
    </View>
  );
}

export default function LoginScreen() {
  const { login } = useAuth();
  const [activationMessage, setActivationMessage] = useState("");
  const [formError, setFormError] = useState("");

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (values) => {
    setActivationMessage("");
    setFormError("");

    const result = await login(values.email, values.password);

    if (result.ok) {
      router.replace("/");
      return;
    }

    if (result.code === "ACCOUNT_NOT_ACTIVATED") {
      setActivationMessage(
        result.message || "Please use your activation link to create your password."
      );
      return;
    }

    setFormError(result.message || "Invalid credentials.");
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerClassName="flex-grow justify-center px-6 py-10"
          keyboardShouldPersistTaps="handled"
        >
          <View className="rounded-lg border border-border bg-card p-6">
            <Text className="mb-1 text-center text-2xl font-bold text-foreground">
              Client Portal
            </Text>
            <Text className="mb-8 text-center text-sm text-muted-foreground">
              Sign in to your mailbox
            </Text>

            <View className="gap-4">
              <Field
                control={control}
                name="email"
                placeholder="Email"
                icon={Mail}
                error={errors.email?.message}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                textContentType="emailAddress"
              />

              <Field
                control={control}
                name="password"
                placeholder="Password"
                icon={Lock}
                error={errors.password?.message}
                secure
                autoCapitalize="none"
                autoComplete="current-password"
                textContentType="password"
              />

              {activationMessage ? (
                <View className="flex-row gap-2 rounded-lg border border-border bg-muted p-3">
                  <AlertCircle size={18} color="#64748b" />
                  <Text className="flex-1 text-sm leading-5 text-muted-foreground">
                    {activationMessage}
                  </Text>
                </View>
              ) : null}

              {formError ? (
                <Text className="text-center text-sm text-destructive">{formError}</Text>
              ) : null}

              <TouchableOpacity
                className={cn(
                  "mt-2 h-12 items-center justify-center rounded-lg bg-primary",
                  isSubmitting && "opacity-60"
                )}
                onPress={handleSubmit(onSubmit)}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#0f172a" />
                ) : (
                  <Text className="text-base font-semibold text-primary-foreground">
                    Sign in
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
