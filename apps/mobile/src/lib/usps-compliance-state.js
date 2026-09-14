/**
 * Que puede hacer el cliente con su USPS Form 1583, segun el backend.
 *
 * La respuesta de GET /client/usps-compliance trae `verification` con lo que la
 * pantalla necesita decidir: estado, si puede subir, por que se rechazo y cuando
 * se aprobo. La app no recalcula esas reglas; solo las lee.
 *
 * `record` se mira unicamente como respaldo defensivo, por si alguna respuesta
 * llega sin `verification`.
 */

export const FORM_1583_ALREADY_APPROVED = "FORM_1583_ALREADY_APPROVED";

export function resolveUspsView(response) {
  const verification = response?.verification || null;
  const record = response?.record || null;

  const status = verification?.status || record?.status || "NOT_SUBMITTED";
  const approved = status === "APPROVED";

  // El backend es quien dice si se puede subir. Aun asi, un aprobado nunca
  // permite subir aunque un campo llegue mal: enviar de nuevo reemplaza la
  // documentacion y la devolveria a revision.
  const uploadsAllowed = approved ? false : verification ? verification.uploadsAllowed !== false : true;

  return {
    status,
    approved,
    uploadsAllowed,
    additionalDocumentsRequired: approved
      ? false
      : verification?.additionalDocumentsRequired ?? true,
    // approvedAt es la fecha de aprobacion. reviewedAt queda solo como respaldo
    // por compatibilidad con respuestas antiguas.
    approvedAt: approved ? verification?.approvedAt || record?.approvedAt || record?.reviewedAt || null : null,
    reviewReason: verification?.reviewReason ?? record?.reviewNotes ?? null,
    currentPlan: verification?.currentPlan || null,
    welcomeMessage: verification?.welcomeMessage || null,
  };
}

/** El formulario --y con el, la camara y los selectores de archivo-- solo se monta si se puede subir. */
export function canShowUploadForm(view) {
  return Boolean(view && view.uploadsAllowed && !view.approved);
}

export function canStartPicker(view) {
  return canShowUploadForm(view);
}

export function isAlreadyApprovedError(error) {
  const data = error?.response?.data || {};
  return data.code === FORM_1583_ALREADY_APPROVED || data.error === FORM_1583_ALREADY_APPROVED;
}

/**
 * Que hacer cuando falla un envio.
 *
 * Si el 1583 se aprobo mientras el cliente preparaba los archivos, no es un
 * error que explicar: se descartan los archivos elegidos, se recarga el estado
 * real y la pantalla pasa sola a aprobado. Cualquier otro fallo se avisa.
 */
export function handleSubmitError(error, { refetch, clearSelection, showError }) {
  if (isAlreadyApprovedError(error)) {
    clearSelection?.();
    refetch?.();
    return "approved";
  }

  showError?.(error);
  return "error";
}
