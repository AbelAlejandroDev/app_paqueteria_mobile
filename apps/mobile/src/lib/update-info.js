/**
 * Que codigo JS esta ejecutando la app: el que vino dentro de la build o una
 * actualizacion OTA (EAS Update), para poder comprobarlo desde el propio movil
 * en Settings sin herramientas.
 *
 * Recibe lo que expo-updates expone (`Updates.updateId`, `isEmbeddedLaunch`,
 * `channel`, `runtimeVersion`) y no importa nada: asi se prueba en Node.
 *
 *   OTA:      "01a1f35b · testflight-sandbox"   (el inicio del Update ID de EAS)
 *   Embebido: "Built-in · testflight-sandbox"  (aun no ha aplicado ninguna OTA)
 *   Sin expo-updates (desarrollo): "Development"
 */
export function describeRunningUpdate({ updateId, isEmbeddedLaunch, channel } = {}) {
  const id = String(updateId || "").trim().toLowerCase();
  const where = String(channel || "").trim();
  if (!id && !where) return "Development";
  const which = isEmbeddedLaunch || !id ? "Built-in" : id.slice(0, 8);
  return where ? which + " · " + where : which;
}
