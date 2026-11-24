import { useAuth } from "@/context/AuthContext";
import { brand } from "@/lib/brand";
import { privacyPolicyFor } from "@/lib/legal-links";
import { useCapabilities } from "@/lib/use-capabilities";

/**
 * La politica de privacidad de la organizacion del usuario, la misma en Settings
 * y en Help: la del backend (capabilities.legal) si es una https valida y, si
 * no, la de la marca (lib/legal-links). Nunca la de otra organizacion. Mientras
 * cargan las capacidades, null (no se ensena un enlace que puede cambiar).
 */
export function usePrivacyPolicy() {
  const { user } = useAuth();
  const capabilities = useCapabilities();
  if (capabilities.isLoading) return null;
  return privacyPolicyFor(user?.tenant?.slug, brand, capabilities.legal);
}
