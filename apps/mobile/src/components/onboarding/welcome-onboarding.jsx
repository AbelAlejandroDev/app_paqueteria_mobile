import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { CreditCard, Package2, ScanLine, Store, Truck } from "lucide-react-native";

import { brand } from "@/lib/brand";
import { overWhite } from "@/lib/colors";
import { brandMark, brandWordmarkOnLight, homeHeroFor } from "@/lib/brand-assets";
import { getClientName } from "@/lib/client-profile";
import { Button } from "@/components/ui/button";
import { ControlIllustration, MailboxIllustration, UpdatesIllustration } from "./illustrations";

const { palette } = brand;

const CARD_ICONS = { package: Package2, pickup: Store, scan: ScanLine, forward: Truck, billing: CreditCard };

/**
 * Portada: el logotipo oficial de la marca (el mismo archivo que el panel) y,
 * si el centro del cliente la tiene, la foto de su oficina. Sin foto, el simbolo.
 */
function WelcomeHero({ clientName, hero }) {
  return (
    <View className="w-full items-center gap-5">
      {brandWordmarkOnLight ? (
        <Image
          source={brandWordmarkOnLight}
          style={{ width: 220, height: 40 }}
          contentFit="contain"
          accessibilityLabel={brand.name}
        />
      ) : null}

      {hero ? (
        <View className="w-full overflow-hidden rounded-3xl" style={{ aspectRatio: 1.45, maxHeight: 240 }}>
          <Image source={hero} style={{ width: "100%", height: "100%" }} contentFit="cover" />
          {/* Un degradado de la marca abajo, para que la foto no se coma el titulo. */}
          <Svg style={{ position: "absolute", left: 0, right: 0, bottom: 0 }} width="100%" height="45%">
            <Defs>
              <LinearGradient id="welcomeFade" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={brand.palette.heroFrom} stopOpacity="0" />
                <Stop offset="1" stopColor={brand.palette.heroFrom} stopOpacity="0.75" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#welcomeFade)" />
          </Svg>
          {clientName ? (
            <Text className="absolute bottom-3 left-4 right-4 font-brand-bold text-lg text-white" numberOfLines={1}>
              {"Hi, " + clientName}
            </Text>
          ) : null}
        </View>
      ) : brandMark ? (
        <View
          className="h-28 w-28 items-center justify-center overflow-hidden rounded-3xl"
          style={{ backgroundColor: brand.markBackground }}
        >
          <Image source={brandMark} style={{ width: "100%", height: "100%" }} contentFit="contain" />
        </View>
      ) : null}
    </View>
  );
}

function GoodToKnowCard({ card }) {
  const Icon = CARD_ICONS[card.icon] || Package2;
  const warning = card.tone === "warning";

  return (
    <View
      className={
        warning
          ? "flex-row gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3"
          : "flex-row gap-3 rounded-2xl border border-border bg-card p-3"
      }
    >
      <View
        className="h-9 w-9 items-center justify-center rounded-xl"
        style={{ backgroundColor: warning ? "#FEF3C7" : overWhite(palette.tint, 0.4) }}
      >
        <Icon size={18} color={warning ? "#B45309" : palette.glyph} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className={warning ? "font-brand-bold text-sm text-amber-900" : "font-brand-bold text-sm text-foreground"}>
          {card.title}
        </Text>
        <Text className={warning ? "mt-0.5 font-brand text-xs leading-5 text-amber-900" : "mt-0.5 font-brand text-xs leading-5 text-muted-foreground"}>
          {card.body}
        </Text>
      </View>
    </View>
  );
}

function SlideArt({ slide, clientName, hero }) {
  if (slide.kind === "welcome") return <WelcomeHero clientName={clientName} hero={hero} />;
  if (slide.kind === "mailbox") return <MailboxIllustration />;
  if (slide.kind === "control") return <ControlIllustration />;
  if (slide.kind === "updates") return <UpdatesIllustration />;
  return null;
}

/**
 * Bienvenida a pantalla completa, antes del recorrido.
 *
 * Una pantalla cada vez con Back/Next/Skip: se puede completar sin gestos ni
 * animaciones. Atras de Android retrocede una pantalla y, en la primera,
 * cierra la bienvenida como "Skip".
 */
export default function WelcomeOnboarding({ visible, slides, user, onSkip, onDone }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [opacity] = useState(() => new Animated.Value(1));
  const compact = height < 700;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [index, reduceMotion, opacity]);

  const slide = slides[index];
  if (!slide) return null;

  const isLast = index === slides.length - 1;
  const clientName = getClientName(user, "");

  return (
    <Modal
      visible={visible}
      animationType={reduceMotion ? "none" : "fade"}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => (index > 0 ? setIndex(index - 1) : onSkip())}
    >
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View className="flex-row items-center justify-between px-5 py-3">
          <Text className="font-brand-semibold text-xs uppercase tracking-wider" style={{ color: palette.glyph }}>
            {`${index + 1} of ${slides.length}`}
          </Text>
          {!isLast ? (
            <Pressable onPress={onSkip} hitSlop={12} accessibilityRole="button" accessibilityLabel="Skip introduction">
              <Text className="font-brand-semibold text-sm text-muted-foreground">Skip</Text>
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          contentContainerClassName="flex-grow justify-center px-6"
          contentContainerStyle={{ paddingVertical: compact ? 8 : 20 }}
        >
          <Animated.View style={{ opacity }} className="items-center">
            <SlideArt slide={slide} clientName={clientName} hero={homeHeroFor(user)} />

            <Text
              className={compact ? "mt-5 text-center font-brand-bold text-2xl text-foreground" : "mt-8 text-center font-brand-bold text-[28px] leading-9 text-foreground"}
              accessibilityRole="header"
            >
              {slide.title}
            </Text>
            <Text className="mt-2 max-w-[340px] text-center font-brand text-base leading-6 text-muted-foreground">
              {slide.description}
            </Text>

            {slide.cards ? (
              <View className="mt-5 w-full max-w-[460px] gap-2.5">
                {slide.cards.map((card) => (
                  <GoodToKnowCard key={card.key} card={card} />
                ))}
              </View>
            ) : null}
          </Animated.View>
        </ScrollView>

        <View className="gap-4 px-6 pb-4 pt-2">
          <View
            className="flex-row items-center justify-center gap-1.5"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {slides.map((item, dot) => (
              <View
                key={item.key}
                className="h-1.5 rounded-full"
                style={{ width: dot === index ? 22 : 7, backgroundColor: dot === index ? brand.primaryColor : "#D5D4D2" }}
              />
            ))}
          </View>

          <View className="flex-row gap-3">
            {index > 0 ? (
              <Button variant="outline" className="flex-1" onPress={() => setIndex(index - 1)} accessibilityLabel="Previous screen">
                Back
              </Button>
            ) : null}
            <Button className="flex-1" onPress={() => (isLast ? onDone() : setIndex(index + 1))}>
              {isLast ? slide.cta || "Get started" : "Next"}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}
