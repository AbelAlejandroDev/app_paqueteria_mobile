import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/context/AuthContext";
import { brand } from "@/lib/brand";
import { useBiometricLock } from "@/components/common/biometric-gate";
import { paymentAlertsQuery } from "@/components/common/payment-alerts";
import {
  CLIENT_ONBOARDING_VERSION,
  getOnboardingRecord,
  needsOnboarding,
  onboardingScope,
  saveOnboardingStatus,
} from "@/lib/onboarding-state";
import { buildTourSteps, buildWelcomeSlides, planOf } from "@/lib/onboarding-content";
import { measureAnchor, TourAnchorContext } from "./tour-anchor";
import TourOverlay from "./tour-overlay";
import WelcomeOnboarding from "./welcome-onboarding";

const OnboardingContext = createContext({ replay: () => {}, active: false });

export function useOnboarding() {
  return useContext(OnboardingContext);
}

/** Espera antes de empezar: deja que la app pinte y que otros avisos aparezcan primero. */
const START_DELAY_MS = 700;

/** Tras volver al panel, un instante para que pinte antes de medir. */
const TOUR_START_DELAY_MS = 450;
const MEASURE_DELAY_MS = 120;

/**
 * Bienvenida y recorrido guiado para clientes nuevos.
 *
 * Vive dentro de la puerta de terminos y del bloqueo, asi que nunca sale en
 * el login, en la activacion, en el reset de contraseña ni encima de los
 * terminos. Tampoco sale con el bloqueo puesto ni mientras haya un aviso de
 * pago en pantalla: espera a que se cierren.
 *
 * Es solo educativo: no navega a ninguna pieza ni pulsa nada. La capa del
 * recorrido recoge todos los toques mientras esta abierta.
 */
export default function OnboardingProvider({ children }) {
  const { user } = useAuth();
  const { locked } = useBiometricLock();
  const scope = onboardingScope(user);

  // phase: "idle" | "welcome" | "tour". `run` cambia en cada apertura y monta
  // la bienvenida de nuevo, asi empieza siempre por la primera pantalla.
  const [session, setSession] = useState({ phase: "idle", run: 0 });
  const [stepIndex, setStepIndex] = useState(0);
  // Cada dato lleva a quien pertenece: lo de otra cuenta o de otro paso no se
  // usa, sin tener que borrarlo cuando cambian.
  const [stored, setStored] = useState({ scope: null, record: undefined });
  const [measured, setMeasured] = useState({ key: null, rect: null, offset: { x: 0, y: 0 } });
  const anchors = useRef(new Map());
  const rootRef = useRef(null);

  const record = stored.scope === scope ? stored.record : undefined;
  const { phase } = session;

  // La misma consulta que PaymentAlerts (una sola peticion en cache), para no
  // enseñar el tutorial encima de un aviso de pago.
  const paymentAlerts = useQuery(paymentAlertsQuery);
  const paymentAlertOpen = (paymentAlerts.data || []).length > 0;

  const plan = planOf(user);
  const welcomeSlides = useMemo(
    () => buildWelcomeSlides({ plan, brandName: brand.appName || brand.shortName || brand.name }),
    [plan]
  );
  const tourSteps = useMemo(() => buildTourSteps({ plan }), [plan]);
  const stepKey = phase === "tour" ? `${session.run}:${stepIndex}` : null;

  // El registro de esta cuenta. Se lee por cuenta y organizacion, asi el
  // progreso de una nunca decide por otra.
  useEffect(() => {
    let active = true;
    getOnboardingRecord(user).then((value) => {
      if (active) setStored({ scope, record: value });
    });
    return () => {
      active = false;
    };
    // `user` solo importa por su id y organizacion, que ya estan en `scope`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  // Primera apertura: con el registro cargado, sin bloqueo ni aviso de pago.
  useEffect(() => {
    if (record === undefined || phase !== "idle" || locked || paymentAlertOpen) return undefined;
    if (!needsOnboarding(user, record)) return undefined;

    const timer = setTimeout(
      () => setSession((current) => ({ phase: "welcome", run: current.run + 1 })),
      START_DELAY_MS
    );
    return () => clearTimeout(timer);
  }, [record, phase, locked, paymentAlertOpen, user]);

  const register = useCallback((id, ref) => {
    anchors.current.set(id, ref);
    return () => {
      if (anchors.current.get(id) === ref) anchors.current.delete(id);
    };
  }, []);

  const finish = useCallback(
    async (status) => {
      setSession((current) => ({ phase: "idle", run: current.run }));
      setStepIndex(0);
      // Con la version: sin ella se leia como "no completado" y el tutorial
      // volvia a abrirse en bucle tras pulsar Skip.
      setStored({ scope, record: { version: CLIENT_ONBOARDING_VERSION, status } });
      await saveOnboardingStatus(user, status);
    },
    [user, scope]
  );

  const startTour = useCallback(() => {
    setStepIndex(0);
    // El recorrido se hace sobre el panel: se vuelve a el antes de medir.
    router.navigate("/dashboard");
    setTimeout(() => setSession((current) => ({ phase: "tour", run: current.run })), TOUR_START_DELAY_MS);
  }, []);

  const replay = useCallback(() => {
    setStepIndex(0);
    setSession((current) => ({ phase: "welcome", run: current.run + 1 }));
  }, []);

  // Mide el elemento del paso. Si no esta montado (o el paso es solo
  // ilustrativo) la tarjeta va centrada, sin resaltar nada.
  useEffect(() => {
    if (!stepKey) return undefined;
    let cancelled = false;
    const step = tourSteps[stepIndex];

    const timer = setTimeout(async () => {
      const root = await measureAnchor(rootRef);
      const ref = step?.anchor ? anchors.current.get(step.anchor) : null;
      const rect = ref ? await measureAnchor(ref) : null;
      if (!cancelled) {
        setMeasured({ key: stepKey, rect, offset: root ? { x: root.x, y: root.y } : { x: 0, y: 0 } });
      }
    }, MEASURE_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [stepKey, stepIndex, tourSteps]);

  // Atras de Android: retrocede un paso, y en el primero cierra el recorrido.
  // Solo mientras el recorrido esta abierto; fuera de el, atras hace lo de siempre.
  useEffect(() => {
    if (phase !== "tour") return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (stepIndex > 0) setStepIndex((value) => value - 1);
      else finish("skipped");
      return true;
    });
    return () => subscription.remove();
  }, [phase, stepIndex, finish]);

  const value = useMemo(() => ({ replay, active: phase !== "idle" }), [replay, phase]);
  const current = measured.key === stepKey ? measured : null;

  return (
    <OnboardingContext.Provider value={value}>
      <TourAnchorContext.Provider value={register}>
        <View ref={rootRef} collapsable={false} style={{ flex: 1 }}>
          {children}

          {/* Hasta tener la medida del paso no se pinta: asi el resaltado nunca
              aparece sobre el elemento del paso anterior. */}
          {phase === "tour" && tourSteps[stepIndex] && current ? (
            <TourOverlay
              step={tourSteps[stepIndex]}
              index={stepIndex}
              total={tourSteps.length}
              target={current.rect}
              offset={current.offset}
              onBack={() => setStepIndex((index) => Math.max(0, index - 1))}
              onNext={() => {
                if (stepIndex >= tourSteps.length - 1) finish("completed");
                else setStepIndex((index) => index + 1);
              }}
              onSkip={() => finish("skipped")}
            />
          ) : null}
        </View>

        <WelcomeOnboarding
          key={session.run}
          visible={phase === "welcome"}
          slides={welcomeSlides}
          user={user}
          onSkip={() => finish("skipped")}
          onDone={startTour}
        />
      </TourAnchorContext.Provider>
    </OnboardingContext.Provider>
  );
}
