import { Pressable, Text, View } from "react-native";
import { Check } from "lucide-react-native";

/**
 * La oferta de autorizacion de cobro automatico tal como la da la API
 * (lib/auto-charge-consent): el texto legal COMPLETO, el maximo con su moneda
 * y una casilla que el cliente marca a mano. Nunca viene marcada.
 *
 * `checked` lo decide quien la usa con isOfferAccepted(acceptedKey, offer):
 * si cambia el texto, la version, el importe o la moneda, deja de estar marcada.
 */
export default function AutoChargeConsentOffer({ offer, checked, onToggle, disabled = false, notice = null }) {
  if (!offer) return null;

  return (
    <View className="gap-3 rounded-lg border border-border bg-card p-4">
      <Text className="font-brand-semibold text-[15px] text-ink">Automatic charge authorization</Text>
      {notice ? <Text className="font-brand text-[13px] leading-5 text-amber-900">{notice}</Text> : null}

      <View className="flex-row justify-between gap-4">
        <Text className="min-w-0 flex-1 font-brand text-[14px] text-ink/70">Maximum per shipment</Text>
        <Text className="font-brand-semibold text-[14px] text-ink">{offer.amountLabel}</Text>
      </View>

      {/* El texto vigente, entero y tal cual: es lo que se acepta. */}
      <View className="rounded-md border border-border bg-muted p-3">
        <Text selectable className="font-brand text-[13px] leading-5 text-ink">
          {offer.text}
        </Text>
      </View>

      <Text className="font-brand text-[12px] leading-4 text-ink/60">
        A saved card alone does not authorize automatic charges. If a shipment costs more than this maximum, you will
        approve and pay it in the app.
      </Text>

      <Pressable
        onPress={disabled ? undefined : onToggle}
        disabled={disabled}
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled }}
        accessibilityLabel={"I authorize automatic charges up to " + offer.amountLabel + " per shipment"}
        className="flex-row items-start gap-3"
      >
        <View
          className={
            checked
              ? "mt-0.5 h-5 w-5 items-center justify-center rounded border-2 border-foreground bg-foreground"
              : "mt-0.5 h-5 w-5 items-center justify-center rounded border-2 border-slate-300 bg-card"
          }
        >
          {checked ? <Check size={14} color="#ffffff" strokeWidth={3} /> : null}
        </View>
        <Text className="min-w-0 flex-1 font-brand-medium text-[14px] leading-5 text-ink">
          {"I have read this authorization and allow my center to charge my saved card up to " +
            offer.amountLabel +
            " per shipment."}
        </Text>
      </Pressable>
    </View>
  );
}
