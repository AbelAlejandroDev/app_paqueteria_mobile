/**
 * Una recogida nace lista para recoger (el backend la abre IN_PROGRESS y pone
 * la pieza en READY_FOR_PICKUP). Los mismos textos y la misma regla que el
 * portal web: la pieza en pantalla cambia con la respuesta del servidor, sin
 * esperar a recargarla.
 */

export const PICKUP_READY_TITLE = "Ready for pickup";

export const PICKUP_READY_CONFIRMATION =
  "Your mail is ready for pickup. Please bring a valid photo ID when collecting it. Authorized individuals must be listed on your account and bring their photo ID.";

export const PICKUP_DIALOG_DESCRIPTION =
  "It will be ready for pickup as soon as you confirm. Bring a valid photo ID; anyone collecting it for you must be on your authorized individuals list.";

/**
 * La respuesta de GET /client/mail-items/:id con la recogida ya abierta. Con
 * una recogida activa no se reenvia ni se descarta; escanear si, porque no la
 * saca del centro (computeAvailableActions en el backend).
 */
export function applyReadyPickup(previous, response) {
  if (!previous?.item) return previous;
  const created = response?.created || null;
  const requests = Array.isArray(previous.item.serviceRequests) ? previous.item.serviceRequests : [];
  return {
    ...previous,
    item: {
      ...previous.item,
      status: response?.mailItem?.status || "READY_FOR_PICKUP",
      serviceRequests: created && !requests.some((r) => r.id === created.id) ? [created, ...requests] : requests,
    },
    availableActions: previous.availableActions
      ? {
          ...previous.availableActions,
          canRequestPickup: false,
          canRequestForward: false,
          canRequestDiscard: false,
          // El escaneo no saca la pieza del centro: lo que dijera antes sigue
          // valiendo (el servidor lo vuelve a decir al recargar).
          canRequestScan: Boolean(previous.availableActions.canRequestScan),
          hasActiveRequest: true,
          hasActiveDisposition: true,
          activeRequests: { ...(previous.availableActions.activeRequests || {}), pickup: true },
        }
      : previous.availableActions,
  };
}
