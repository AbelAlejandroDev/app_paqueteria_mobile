import * as LocalAuthentication from "expo-local-authentication";
import { getJsonValue, setJsonValue } from "@paqueteria/core";

const KEY = "security-preferences";

export const DEFAULT_SECURITY_PREFERENCES = {
  // Mantener la sesion entre aperturas. Apagarlo borra las credenciales al
  // cerrar la app, asi que la proxima vez habra que entrar de nuevo.
  keepLoggedIn: true,
  // Pedir el bloqueo del dispositivo al abrir la app.
  requireBiometrics: false,
};

/**
 * Las preferencias viven en AsyncStorage y no en SecureStore a proposito: son
 * dos booleanos, no un secreto. Lo que protege el acceso es el sistema
 * operativo al pedir la autenticacion, y la sesion sigue guardada en SecureStore.
 * La app nunca ve ni guarda huellas ni datos de la cara: solo recibe del
 * sistema un "si" o un "no".
 */
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
 * Apaga el bloqueo al cerrar sesion.
 *
 * La preferencia es del dispositivo, no de la cuenta. Si se conservara, la
 * siguiente persona que entrase en este telefono se encontraria un bloqueo que
 * no activo ella.
 */
export async function clearBiometricLock() {
  const current = await getSecurityPreferences();
  if (!current.requireBiometrics) return current;
  return setSecurityPreferences({ ...current, requireBiometrics: false });
}

function labelFor(types, level) {
  if (level < LocalAuthentication.SecurityLevel.BIOMETRIC_WEAK) return "Screen lock";

  const hasFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
  const hasFingerprint = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);

  if (hasFace && hasFingerprint) return "Fingerprint or face";
  if (hasFace) return "Face recognition";
  return "Fingerprint";
}

/**
 * Que puede ofrecer este dispositivo.
 *
 * Se mira el nivel de bloqueo inscrito y no solo si hay biometria, porque el
 * bloqueo acepta tambien el PIN, patron o contrasena del sistema: un telefono
 * sin huella pero con PIN puede proteger la app igual. Lo unico que no se puede
 * es proteger un telefono que no tiene ningun bloqueo configurado.
 */
export async function getBiometricSupport() {
  try {
    const [hasHardware, level, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.getEnrolledLevelAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);

    if (level === LocalAuthentication.SecurityLevel.NONE) {
      return {
        available: false,
        reason: hasHardware
          ? "Set up a fingerprint, face or screen lock in your device settings to use this."
          : "Set up a PIN, pattern or password in your device settings to use this.",
      };
    }

    return {
      available: true,
      hasBiometrics: level >= LocalAuthentication.SecurityLevel.BIOMETRIC_WEAK,
      label: labelFor(types, level),
    };
  } catch (error) {
    return { available: false, reason: "Your device security settings could not be checked." };
  }
}

/**
 * Pide la autenticacion al sistema.
 *
 * Devuelve el motivo y no un simple booleano: cancelar no es un error, y la
 * pantalla tiene que tratar distinto a quien toco "Cancel" que a quien fallo o
 * tiene el lector bloqueado por demasiados intentos.
 *
 * Se permite el respaldo del dispositivo (PIN, patron o contrasena). Sin el,
 * un fallo del lector o una huella que no se reconoce dejarian al cliente fuera
 * de su propia app sin otra salida que desinstalarla.
 */
export async function authenticate(promptMessage = "Unlock The Worx") {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: "Cancel",
      disableDeviceFallback: false,
    });

    if (result.success) return { success: true, cancelled: false, error: null };

    const cancelled = ["user_cancel", "system_cancel", "app_cancel"].includes(result.error);
    return { success: false, cancelled, error: result.error || "unknown" };
  } catch (error) {
    return { success: false, cancelled: false, error: "unknown" };
  }
}

/** Mensaje para el cliente segun lo que devolvio el sistema. */
export function describeAuthenticationError(error) {
  switch (error) {
    case "lockout":
      return "Too many attempts. Unlock your phone first, then try again.";
    case "not_enrolled":
    case "passcode_not_set":
      return "Your device no longer has a screen lock set up.";
    case "not_available":
      return "Authentication is not available on this device right now.";
    default:
      return "We could not verify it was you. Try again.";
  }
}
