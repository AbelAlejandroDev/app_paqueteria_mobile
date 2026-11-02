/**
 * Textos y validacion de la solicitud de borrado de cuenta
 * (GET/POST /client/account-deletion).
 *
 * El backend decide todo: si se puede pedir, que pasa con la membresia, que se
 * borra y que se conserva, y en que estado esta. Aqui solo se ponen en
 * palabras y se comprueba lo minimo antes de mandar la peticion. Los mismos
 * textos que el portal web (src/lib/accountDeletion.js en el front).
 */

export const DELETION_STATUS_COPY = {
  PENDING: {
    tone: "amber",
    title: "Deletion request in review",
    body: "Your center is reviewing your request. Nothing has been deleted yet.",
  },
  WAITING_MEMBERSHIP_CANCELLATION: {
    tone: "amber",
    title: "Waiting for your membership to end",
    body: "Your membership has to end first. Your deletion request continues automatically after that; you don't need to send it again.",
  },
  INFO_REQUIRED: {
    tone: "amber",
    title: "More information needed",
    body: "Your center needs more information before continuing.",
  },
  APPROVED: {
    tone: "emerald",
    title: "Deletion request approved",
    body: "Your personal data will be deleted, except the records the law requires us to keep. We'll confirm by email when it's done.",
  },
  REJECTED: {
    tone: "rose",
    title: "Deletion request not approved",
    body: "Your center could not complete this request.",
  },
  WITHDRAWN: {
    tone: "slate",
    title: "Deletion request withdrawn",
    body: "You withdrew this request. You can send a new one at any time.",
  },
  COMPLETED: {
    tone: "emerald",
    title: "Account deleted",
    body: "Your account and personal data were deleted.",
  },
};

export function deletionStatusCopy(status) {
  return DELETION_STATUS_COPY[status] || DELETION_STATUS_COPY.PENDING;
}

/**
 * La regla del preaviso, con los dias que manda el servidor (15 en The Worx).
 * Sin dato (HDG: el centro lo gestiona a mano) no se promete ninguna regla.
 */
export function describeNoticeRule(days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `Membership cancellations need ${n} days' notice before the next renewal. With ${n} days or more, the membership ends when the current period ends and the next renewal is not charged. With less than ${n} days, one last renewal is charged and the membership ends when that period ends.`;
}

/** Lo que se le explica de la membresia antes de pedir el borrado. */
export function describeMembershipEffect(membership) {
  if (!membership?.active) return null;
  if (membership.cancellation) {
    const end = membership.cancellation.display?.effectiveAt;
    return end
      ? `Your membership cancellation is already in progress and ends on ${end}. Your deletion request will continue after that.`
      : "Your membership cancellation is already in progress. Your deletion request will continue after it ends.";
  }
  if (membership.plan) {
    const end = membership.plan.display?.effectiveAt;
    return membership.plan.willBeChargedAgain
      ? `Your membership is still active. We'll request its cancellation with the usual ${membership.plan.noticePeriodDays}-day notice: one more renewal on ${membership.plan.display?.nextChargeAt} will still be charged, and it ends on ${end}. Your deletion request continues after that.`
      : `Your membership is still active. We'll request its cancellation: it ends on ${end} with no further charges, and your deletion request continues after that.`;
  }
  return "Your membership is still active. Your center will end it before continuing with your deletion request.";
}

/**
 * El cuerpo de POST /client/account-deletion, o el motivo por el que no se
 * puede mandar todavia. Nunca lleva ids: la cuenta es la de la sesion.
 */
export function deletionRequestBody({ password, reason, acknowledged }) {
  if (!acknowledged) return { ok: false, message: "Confirm that you understand what will be deleted." };
  if (!String(password || "")) return { ok: false, message: "Enter your password to confirm it's you." };
  const trimmed = String(reason || "").trim();
  return {
    ok: true,
    body: { password: String(password), acknowledge: true, ...(trimmed ? { reason: trimmed.slice(0, 500) } : {}) },
  };
}

/** El cuerpo de POST /client/membership/cancellation: el motivo es opcional. */
export function cancellationRequestBody(reason) {
  const trimmed = String(reason || "").trim();
  return trimmed ? { reason: trimmed.slice(0, 500) } : {};
}
