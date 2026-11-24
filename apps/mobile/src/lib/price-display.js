/**
 * Como se ensena al cliente lo que cuesta un reenvio. Sin React, para probarlo.
 *
 * Tres lineas y nada mas:
 *   Shipping & Handling  franqueo del transportista CON la gestion interna dentro
 *   Mail Forwarding Fee  el cargo de reenvio (adminFee / immediateForwardFee)
 *   Total                lo que se cobra
 *
 * La gestion interna (postageFee / serviceFee, $2 en HDG) nunca es una linea
 * propia: va dentro de Shipping & Handling. El backend conserva el desglose para
 * contabilidad; la app no lo enseña.
 *
 * La app no calcula tarifas ni cargos: cada importe sale de un campo del backend
 * (contrato f7c677a):
 *   - tarifa de POST /client/forwarding/quotes: totalAmount.amount ya trae la
 *     gestion (forwardingQuotes.withServiceFee); el cargo de reenvio llega
 *     aparte en immediateForwardFeeCents;
 *   - prepare-payment de Zoho: postageAmount = franqueo + gestion,
 *     adminFeeAmount = cargo de reenvio, amount = total;
 *   - forwardDetails de la pieza: quotedAmountCents (franqueo + gestion),
 *     acceptedRepricedAmount si se reconfirmo, paymentAmount = lo cobrado.
 * Un importe que el backend no da se queda en null ("pendiente"), nunca en 0.
 */

export const SHIPPING_AND_HANDLING_LABEL = "Shipping & Handling";
export const MAIL_FORWARDING_FEE_LABEL = "Mail Forwarding Fee";
export const TOTAL_LABEL = "Total";

const cents = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
};

/**
 * Las lineas para pintar. `total` solo se da por bueno si viene del backend o si
 * las dos partes son conocidas; si falta una, el total queda pendiente: nunca un
 * subtotal que parezca el precio final.
 *
 * @returns {{ shippingAndHandling: number|null, mailForwardingFee: number|null, total: number|null, complete: boolean }}
 */
export function customerCharge({ shippingAndHandling = null, mailForwardingFee = null, total = null } = {}) {
  const sh = cents(shippingAndHandling);
  const fee = cents(mailForwardingFee);
  const fromBackend = cents(total);
  const sum = sh !== null && fee !== null ? sh + fee : null;
  const resolvedTotal = fromBackend !== null ? fromBackend : sum;
  return {
    shippingAndHandling: sh,
    mailForwardingFee: fee,
    total: resolvedTotal,
    complete: sh !== null && resolvedTotal !== null,
  };
}

/** Una tarifa elegida en la cotizacion, con el cargo de reenvio de la misma respuesta. */
export function chargeFromRate(rate, immediateForwardFeeCents) {
  return customerCharge({
    shippingAndHandling: rate?.totalAmount?.amount,
    mailForwardingFee: immediateForwardFeeCents,
  });
}

/** La respuesta de prepare-payment de Zoho (o la del modo demo, que tiene la misma forma). */
export function chargeFromZohoPayment(data) {
  return customerCharge({
    shippingAndHandling: data?.postageAmount,
    mailForwardingFee: data?.adminFeeAmount,
    total: data?.amount,
  });
}

/**
 * El historial de un reenvio (forwardDetails). El cargo de reenvio no viaja en
 * forwardDetails (f7c677a), asi que no se inventa: el total es lo cobrado
 * (paymentAmount) cuando lo hay.
 */
export function chargeFromForwardDetails(details) {
  const d = details || {};
  const quoted = cents(d.quotedAmountCents);
  const reconfirmed = cents(d.acceptedRepricedAmount);
  return {
    quoted,
    reconfirmed,
    shippingAndHandling: reconfirmed !== null ? reconfirmed : quoted,
    // Lo que el backend dice que se cobro; sin pago, no hay total que ensenar.
    total: cents(d.paymentAmount),
  };
}

/** Las filas [{ label, cents, strong }] de un cargo, para cualquier tarjeta. */
export function chargeRows(charge) {
  const rows = [{ label: SHIPPING_AND_HANDLING_LABEL, cents: charge?.shippingAndHandling ?? null }];
  if (charge?.mailForwardingFee !== null && charge?.mailForwardingFee !== undefined && charge.mailForwardingFee > 0) {
    rows.push({ label: MAIL_FORWARDING_FEE_LABEL, cents: charge.mailForwardingFee });
  }
  rows.push({ label: TOTAL_LABEL, cents: charge?.total ?? null, strong: true });
  return rows;
}
