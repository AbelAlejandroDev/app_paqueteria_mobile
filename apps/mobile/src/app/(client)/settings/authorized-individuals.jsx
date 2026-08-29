import { ScrollView } from "react-native";

import AuthorizedIndividualsPanel from "@/components/common/authorized-individuals-panel";

/**
 * El panel ya trae su propia consulta y sus estados de carga y error, asi que
 * al vivir en su ruta se pide solo cuando el cliente entra aqui.
 */
export default function AuthorizedIndividualsScreen() {
  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="p-4 pb-24">
      <AuthorizedIndividualsPanel />
    </ScrollView>
  );
}
