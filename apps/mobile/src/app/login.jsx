import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, Eye, EyeOff, Lock, Mail } from "lucide-react-native";

import { useAuth } from "@/context/AuthContext";
import BrandIdentity from "@/components/common/brand-identity";
import { brand } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { INPUT_MIN_HEIGHT, inputTextStyle } from "@/components/ui/input";

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
          "flex-row items-center rounded-lg border bg-card px-3",
          error ? "border-destructive" : "border-input"
        )}
        // Mas alto que el resto de campos: es la primera pantalla y la mas usada.
        style={{ minHeight: INPUT_MIN_HEIGHT + 4 }}
      >
        <Icon size={18} color="#94a3b8" />
        <Controller
          control={control}
          name={name}
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              className="ml-2.5 flex-1 self-stretch text-base text-foreground"
              style={inputTextStyle}
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
  // Telefonos de 360 dp como el Galaxy A06: con los margenes de pantalla y de
  // tarjeta completos, al formulario le quedaba poco mas de 270 dp.
  const compact = useWindowDimensions().width < 380;

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
        // Tambien en Android: con edge-to-edge la ventana ya no se encoge sola al
        // abrir el teclado, y en un telefono de 800 dp tapaba password y Sign in.
        behavior="padding"
      >
        <ScrollView
          contentContainerClassName={cn("flex-grow justify-center", compact ? "px-4 py-6" : "px-6 py-10")}
          keyboardShouldPersistTaps="handled"
        >
          <View className={cn("rounded-lg border border-border bg-card", compact ? "px-5 py-6" : "p-6")}>
            <BrandIdentity centered className="mb-2" />
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
                  "mt-2 items-center justify-center rounded-lg bg-primary px-4 py-2",
                  isSubmitting && "opacity-60"
                )}
                style={{ minHeight: INPUT_MIN_HEIGHT + 4 }}
                onPress={handleSubmit(onSubmit)}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator color={brand.primaryForeground} />
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
