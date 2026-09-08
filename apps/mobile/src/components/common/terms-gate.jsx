import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import { useMutation, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { brand } from "@/lib/brand";
import { brandWordmarkOnLight } from "@/lib/brand-assets";
import { useAuth } from "@/context/AuthContext";
import { getClientName, getOrganizationName } from "@/lib/client-profile";
import { formatErrorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Modal, Notice } from "@/components/ui/modal";

const QUERY_KEY = ["auth-terms-current"];

/**
 * Bienvenida tras aceptar, una sola vez.
 *
 * No necesita recordarse en el dispositivo: solo se muestra en respuesta a una
 * aceptacion recien hecha, y esa solo ocurre una vez por documento.
 */
function WelcomeModal({ visible, onClose, organizationName, clientName }) {
  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title={organizationName ? "Welcome to " + organizationName : "Welcome"}
      footer={<Button onPress={onClose}>Get started</Button>}
    >
      <View className="items-center gap-4 py-2">
        {brandWordmarkOnLight ? (
          <Image
            source={brandWordmarkOnLight}
            style={{ width: "70%", height: 48 }}
            contentFit="contain"
            accessibilityLabel={brand.name}
          />
        ) : null}

        <Text className="text-center text-xl font-semibold text-foreground">
          {clientName ? "Hi, " + clientName : "Hi there"}
        </Text>

        <Text className="text-center text-sm leading-6 text-muted-foreground">
          Your mailbox is ready. You can see what arrives, ask us to scan or forward it, and
          manage your account from here.
        </Text>
      </View>
    </Modal>
  );
}

/**
 * Pantalla de terminos, a pantalla completa.
 *
 * El boton de aceptar va al final del texto y no fijo abajo, porque el propio
 * encabezado pide leerlos hasta el final: con el boton siempre a la vista, esa
 * frase seria mentira.
 */
function TermsScreen({ terms, organizationName, onAccept, accepting, error }) {
  const heading = (organizationName ? organizationName + " " : "") + "Terms & Conditions";

  return (
    <View className="flex-1 bg-background">
      <ScrollView contentContainerClassName="gap-5 p-5 pb-16">
        <View className="items-center gap-4">
          {brandWordmarkOnLight ? (
            <Image
              source={brandWordmarkOnLight}
              style={{ width: "70%", height: 48 }}
              contentFit="contain"
              accessibilityLabel={brand.name}
            />
          ) : null}

          <Text className="text-center text-2xl font-semibold tracking-tight text-foreground">
            {heading}
          </Text>
          <Text className="text-center text-sm leading-5 text-muted-foreground">
            Please read and accept at the very end of this page.
          </Text>
        </View>

        <View className="rounded-lg border border-border bg-card p-4">
          {terms?.title ? (
            <Text className="mb-3 text-base font-semibold text-foreground">{terms.title}</Text>
          ) : null}
          {/* El administrador lo escribe en texto plano, asi que se pinta tal
              cual: los saltos de linea que puso son los que se ven. */}
          <Text className="text-sm leading-6 text-foreground">{terms?.content || ""}</Text>
        </View>

        {error ? <Notice tone="rose">{error}</Notice> : null}

        <Button loading={accepting} onPress={onAccept}>
          I accept
        </Button>

        {terms?.version ? (
          <Text className="text-center text-xs text-muted-foreground">Version {terms.version}</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

/**
 * Puerta de terminos antes de dejar entrar en la app.
 *
 * Los terminos son del centro del cliente, no de la organizacion: el backend
 * los resuelve por `centerId`, asi que aqui no hay que elegir nada.
 *
 * Si el centro no tiene documento publicado, el backend responde
 * `needsAcceptance: false` y no se interpone nada.
 */
export default function TermsGate({ children }) {
  const { user } = useAuth();
  const [welcomeOpen, setWelcomeOpen] = useState(false);

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => (await api.get("/auth/terms/current")).data,
    staleTime: 5 * 60_000,
  });

  const accept = useMutation({
    mutationFn: async () => (await api.post("/auth/terms/current/accept")).data,
    onSuccess: async () => {
      setWelcomeOpen(true);
      await query.refetch();
    },
  });

  if (query.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={brand.primaryColor} />
      </View>
    );
  }

  // Un fallo de red no puede dejar al cliente fuera de su buzon. Se le deja
  // pasar y la puerta vuelve a intentarlo en el siguiente arranque, que es
  // preferible a bloquear a alguien por algo que no depende de el.
  if (query.data?.needsAcceptance && query.data?.terms) {
    return (
      <TermsScreen
        terms={query.data.terms}
        organizationName={getOrganizationName(user)}
        accepting={accept.isPending}
        error={accept.isError ? formatErrorMessage(accept.error, "Unable to accept the terms.") : ""}
        onAccept={() => accept.mutate()}
      />
    );
  }

  return (
    <>
      {children}
      <WelcomeModal
        visible={welcomeOpen}
        onClose={() => setWelcomeOpen(false)}
        organizationName={getOrganizationName(user)}
        clientName={getClientName(user, "")}
      />
    </>
  );
}
