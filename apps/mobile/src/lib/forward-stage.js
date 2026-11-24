/**
 * En que punto esta un reenvio, en palabras del cliente. Sin React, para
 * probarlo.
 *
 * Solo con lo que el backend ya devuelve (f7c677a, enums de prisma):
 *   ServiceRequestStatus  OPEN, PROCESSING, IN_PROGRESS, AWAITING_CLIENT_APPROVAL,
 *                         READY_TO_SHIP, COMPLETED, REJECTED, CANCELLED
 *   ForwardPaymentStatus  NOT_STARTED, RECONFIRMATION_REQUIRED, READY_FOR_PAYMENT,
 *                         PAYMENT_PENDING, AUTHENTICATION_REQUIRED, PAID, FAILED,
 *                         CANCELLED, REFUNDED
 *   ForwardShipmentStatus NOT_CREATED, PENDING_FULFILLMENT, CREATING, CREATED,
 *                         LABEL_PURCHASED, VOIDED, SHIPPED, DELIVERED, EXCEPTION
 *
 * Vale igual si el pago lo empieza el cliente o el centro (cobro de la tarjeta
 * guardada iniciado por el personal): el estado del pago es el mismo. Un estado
 * que la app no conoce no se interpreta: se ensena tal cual, sin inventar nada.
 *
 * `action` dice que puede hacer el cliente:
 *   "pay"            pagar (tarjeta de pago de la pieza);
 *   "authenticate"   abrir el pago para responder al banco;
 *   "update-payment" el cobro fallo: revisar o cambiar el metodo de pago;
 *   "approve"        aceptar algo que pide el centro (seguimiento);
 *   null             nada: esperar.
 */

const OPEN = ["OPEN", "PROCESSING", "IN_PROGRESS"];
const LABEL_DONE = ["LABEL_PURCHASED", "CREATED"];
const LABEL_IN_PROGRESS = ["PENDING_FULFILLMENT", "CREATING"];

/**
 * `options` (cartas y sobres grandes de HDG; sin ellas, todo como antes):
 *   staffPrepared  la pieza la prepara el centro: el rechazo ofrece las dos
 *                  salidas (actualizar la tarjeta o pagar en la app).
 *   staffCharge    staffChargeDecision (lib/auto-charge-consent): con
 *                  mode "staff-charge", READY_FOR_PAYMENT no pide pagar: el
 *                  centro cobra la tarjeta guardada hasta el maximo autorizado.
 */
export function describeForwardStage(request, { staffPrepared = false, staffCharge = null } = {}) {
  if (!request || request.type !== "FORWARD") return null;
  const status = String(request.status || "");
  const d = request.forwardDetails || {};
  const payment = String(d.paymentStatus || "NOT_STARTED");
  const shipment = String(d.shipmentStatus || "NOT_CREATED");
  const quoted = Number(d.quotedAmountCents || 0) > 0;

  if (status === "CANCELLED" || status === "REJECTED") {
    return { key: "closed", title: status === "CANCELLED" ? "Forward cancelled" : "Forward declined", tone: "rose", action: null };
  }
  if (shipment === "DELIVERED") return { key: "delivered", title: "Delivered", tone: "emerald", action: null };
  if (shipment === "SHIPPED" || status === "COMPLETED") {
    return { key: "shipped", title: "Shipped", description: "Your center has dispatched this shipment.", tone: "emerald", action: null };
  }
  if (shipment === "EXCEPTION") {
    return {
      key: "review",
      title: "Your center is reviewing this shipment",
      description: "They will update this request. You don't need to pay again.",
      tone: "amber",
      action: null,
    };
  }
  if (LABEL_DONE.includes(shipment) || d.trackingNumber || status === "READY_TO_SHIP") {
    return { key: "label-purchased", title: "Label purchased", description: "Your shipment is ready to be dispatched.", tone: "emerald", action: null };
  }
  if (payment === "PAID") {
    return {
      key: "label-in-preparation",
      title: "Payment confirmed",
      description: LABEL_IN_PROGRESS.includes(shipment) || shipment === "NOT_CREATED"
        ? "We're preparing your shipping label."
        : "Your center is preparing your shipment.",
      tone: "emerald",
      action: null,
    };
  }
  if (payment === "REFUNDED") return { key: "refunded", title: "Payment refunded", tone: "amber", action: null };
  if (payment === "CANCELLED") return { key: "payment-cancelled", title: "Payment cancelled", tone: "amber", action: null };
  if (payment === "FAILED") {
    return {
      key: "payment-declined",
      title: staffPrepared ? "Card declined" : "Payment declined",
      description: staffPrepared
        ? "Update your card so your center can charge it again, or pay in the app."
        : "The payment did not go through. Review your payment method, then try again.",
      tone: "rose",
      action: "update-payment",
    };
  }
  if (payment === "AUTHENTICATION_REQUIRED") {
    return {
      key: "authorization-required",
      title: "Pending your authorization",
      description: "Your bank asked you to confirm this payment.",
      tone: "amber",
      action: "authenticate",
    };
  }
  if (payment === "PAYMENT_PENDING") {
    return { key: "payment-processing", title: "Payment processing", description: "We're waiting for the payment confirmation.", tone: "amber", action: null };
  }
  if (status === "AWAITING_CLIENT_APPROVAL") {
    return { key: "awaiting-approval", title: "Waiting for your approval", tone: "amber", action: "approve" };
  }
  if (OPEN.includes(status) && !quoted) {
    return {
      key: "staff-preparation",
      title: "Waiting for staff preparation",
      description: "Your center will weigh and prepare it. You'll see the total before anything is charged.",
      tone: "sky",
      action: null,
    };
  }
  if (OPEN.includes(status) && quoted && payment === "READY_FOR_PAYMENT" && staffCharge?.mode === "staff-charge") {
    return {
      key: "staff-charge",
      title: "Your center will charge your saved card",
      description: (staffCharge.maxLabel ? "Up to " + staffCharge.maxLabel + ". " : "") + "You will be notified.",
      tone: "sky",
      action: null,
    };
  }
  if (OPEN.includes(status) && quoted && ["NOT_STARTED", "READY_FOR_PAYMENT", "RECONFIRMATION_REQUIRED"].includes(payment)) {
    return { key: "payment-pending", title: "Payment pending", description: "Your shipment is priced and ready to pay.", tone: "amber", action: "pay" };
  }
  // Algo que la app no conoce: se dice tal cual, sin interpretarlo.
  return { key: "unknown", title: humanize(payment !== "NOT_STARTED" ? payment : status), tone: "sky", action: null };
}

function humanize(value) {
  const text = String(value || "").toLowerCase().replace(/_/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "In progress";
}

/** La solicitud de reenvio mas reciente de la pieza (la que se resume). */
export function latestForwardRequest(serviceRequests) {
  const list = (Array.isArray(serviceRequests) ? serviceRequests : []).filter((r) => r?.type === "FORWARD");
  return list.reduce((latest, r) => (!latest || Date.parse(r.createdAt || 0) > Date.parse(latest.createdAt || 0) ? r : latest), null);
}

/** Estado de la etiqueta en palabras del cliente (null si aun no hay nada que decir). */
export function labelStatusText(details) {
  const shipment = String(details?.shipmentStatus || "NOT_CREATED");
  if (["SHIPPED", "DELIVERED"].includes(shipment)) return "Shipped";
  if (LABEL_DONE.includes(shipment) || details?.trackingNumber) return "Purchased";
  if (LABEL_IN_PROGRESS.includes(shipment)) return "In preparation";
  if (shipment === "EXCEPTION") return "Under review by your center";
  if (shipment === "VOIDED") return "Voided";
  return null;
}
