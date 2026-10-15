/**
 * Textos de la baja de la membresia (GET/POST /client/membership/cancellation).
 *
 * Las fechas llegan ya escritas en la hora del centro (`display`): se pintan
 * tal cual. Si la app las formateara con la zona del telefono, un cliente de
 * viaje leeria un dia distinto del que el centro le prometio.
 */

const STATUS_LABELS = {
  PENDING: "Requested — waiting for your center",
  APPROVED: "Approved by your center",
  SCHEDULED: "Scheduled",
  REJECTED: "Not approved",
  COMPLETED: "Completed",
  CANCELED: "Withdrawn",
};

export function cancellationStatusLabel(status) {
  return STATUS_LABELS[status] || "In review";
}

/** Lo que se le explica al cliente antes de pedir la baja. */
export function describeCancellationPreview(preview) {
  if (!preview) return null;
  const existing = preview.existingRequest || null;
  if (existing && !["REJECTED", "CANCELED"].includes(existing.status)) {
    return {
      kind: "existing",
      status: cancellationStatusLabel(existing.status),
      lines: [
        existing.display?.effectiveAt ? `Membership ends on ${existing.display.effectiveAt}.` : null,
        existing.willBeChargedAgain && existing.display?.nextBillingAtAtRequest
          ? `The ${existing.display.nextBillingAtAtRequest} renewal is still charged.`
          : null,
      ].filter(Boolean),
      canRequest: false,
    };
  }
  if (!preview.canRequest) {
    return { kind: "unavailable", lines: [preview.message || "Contact your center to cancel your membership."], canRequest: false };
  }
  const d = preview.display || {};
  return {
    kind: "available",
    lines: [
      d.effectiveAt ? `If you request it today, your membership ends on ${d.effectiveAt}.` : null,
      preview.willBeChargedAgain && d.nextChargeAt
        ? `Cancellations need ${preview.noticePeriodDays} days' notice, so the ${d.nextChargeAt} renewal will still be charged.`
        : "No further renewal will be charged.",
      "Your center reviews the request before it is final.",
    ].filter(Boolean),
    canRequest: true,
  };
}
