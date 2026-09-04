import * as LocalAuthentication from "expo-local-authentication";
import { getJsonValue, setJsonValue } from "@paqueteria/core";

const KEY = "security-preferences";

export const DEFAULT_SECURITY_PREFERENCES = {
  // Mantener la sesion entre aperturas. Apagarlo borra las credenciales al
  // cerrar la app, asi que la proxima vez habra que entrar de nuevo.
  keepLoggedIn: true,
  // Pedir huella o rostro al abrir la app.
  requireBiometrics: false,
};

export async function getSecurityPreferences() {
  const stored = await getJsonValue(KEY);
  return { ...DEFAULT_SECURITY_PREFERENCES, ...(stored || {}) };
}

export async function setSecurityPreferences(next) {
  const merged = { ...DEFAULT_SECURITY_PREFERENCES, ...(next || {}) };
  await setJsonValue(KEY, merged);
  return merged;
}

/**
 * Que ofrece el dispositivo.
 *
 * En iOS suele ser Face ID o Touch ID; en Android, huella o rostro. La misma
 * API cubre las dos, asi que la etiqueta se decide con lo que responda el
 * dispositivo en vez de con la plataforma.
 */
export async function getBiometricSupport() {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) return { available: false, reason: "This device has no biometric reader." };

    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    if (!isEnrolled) {
      return { available: false, reason: "No fingerprint or face is enrolled on this device." };
    }

    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const hasFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    const hasFingerprint = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);

    return {
      available: true,
      label: hasFace && !hasFingerprint ? "Face recognition" : hasFace ? "Fingerprint or face" : "Fingerprint",
    };
  } catch (error) {
    return { available: false, reason: "The biometric reader could not be checked." };
  }
}

/** Pide la comprobacion; devuelve true solo si el dispositivo la valida. */
export async function authenticate(promptMessage = "Confirm your identity") {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: "Cancel",
      // Sin esto, Android ofrece el PIN como alternativa y el interruptor
      // dejaria de significar "biometria".
      disableDeviceFallback: false,
    });

    return Boolean(result.success);
  } catch (error) {
    return false;
  }
}
