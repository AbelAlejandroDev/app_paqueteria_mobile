/**
 * Un reenvio ya pagado cuya etiqueta todavia no esta.
 *
 * Desde octubre de 2026 la etiqueta la compra un proceso aparte (el worker), no
 * la peticion de pago: entre "pagado" y "listo para enviar" pasan unos
 * segundos, o mas si Pitney tarda. En ese tramo la solicitud sigue OPEN o
 * PROCESSING con el pago PAID, y la pantalla no tenia tarjeta para ello: el
 * cliente pagaba y no veia nada. Tambien es el estado en el que queda si la
 * compra necesita revision del centro; al cliente no se le enseñan codigos
 * internos, solo que el centro se encarga.
 */

const OPEN_STATUSES = ["OPEN", "PROCESSING", "IN_PROGRESS"];
const POLL_WINDOW_MS = 10 * 60 * 1000;

export function findPaidForwardAwaitingLabel(serviceRequests) {
  const list = Array.isArray(serviceRequests) ? serviceRequests : [];
  return (
    list.find((r) => {
      const d = r?.forwardDetails;
      return (
        r?.type === "FORWARD"
        && OPEN_STATUSES.includes(r?.status)
        && d?.paymentStatus === "PAID"
        && !d?.trackingNumber
        && !["LABEL_PURCHASED", "SHIPPED", "DELIVERED"].includes(d?.shipmentStatus)
      );
    }) || null
  );
}

/** Lo que ve el cliente. Nunca el failureCode ni el mensaje tecnico. */
export function describePaidForwardProgress(request) {
  const needsReview = request?.forwardDetails?.shipmentStatus === "EXCEPTION";
  return needsReview
    ? {
        title: "Payment received",
        description: "Your center is reviewing the shipping label. They'll update this request; you don't need to pay again.",
        needsReview: true,
      }
    : {
        title: "Payment received",
        description: "We're preparing your shipping label. This usually takes less than a minute.",
        needsReview: false,
      };
}

/**
 * Si conviene volver a pedir el item para recoger la etiqueta: solo mientras se
 * esta preparando (no en revision) y durante los primeros minutos tras pagar.
 */
export function shouldPollForLabel(serviceRequests, now = Date.now()) {
  const request = findPaidForwardAwaitingLabel(serviceRequests);
  if (!request) return false;
  if (request.forwardDetails?.shipmentStatus === "EXCEPTION") return false;
  const paidAt = Date.parse(request.forwardDetails?.paidAt || "");
  if (!Number.isFinite(paidAt)) return true;
  return now - paidAt < POLL_WINDOW_MS;
}
