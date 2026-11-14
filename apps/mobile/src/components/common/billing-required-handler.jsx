import { useEffect } from "react";
import { Alert } from "react-native";
import { router, usePathname } from "expo-router";

import { BILLING_ROUTE, billingPromptGate, subscribeBillingRequired } from "@/lib/billing-required";

/**
 * Aviso de 402 BILLING_REQUIRED: la cuenta tiene la facturacion en mora.
 *
 * Pregunta antes de llevar a Facturacion (no se interrumpe al cliente a mitad
 * de algo), con router.navigate para no apilar pantallas. La puerta
 * (lib/billing-required) evita el bucle: no estando ya en Facturacion, uno a
 * la vez y como mucho uno por minuto.
 */
export default function BillingRequiredHandler() {
  const pathname = usePathname();

  useEffect(() => {
    return subscribeBillingRequired(({ message }) => {
      if (!billingPromptGate.tryOpen(pathname)) return;

      Alert.alert(
        "Billing needs attention",
        message,
        [
          { text: "Not now", style: "cancel", onPress: () => billingPromptGate.close() },
          {
            text: "Go to Billing",
            onPress: () => {
              billingPromptGate.close();
              router.navigate(BILLING_ROUTE);
            },
          },
        ],
        { cancelable: true, onDismiss: () => billingPromptGate.close() }
      );
    });
  }, [pathname]);

  return null;
}
