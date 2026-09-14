import test from "node:test";
import assert from "node:assert/strict";

import {
  FORM_1583_ALREADY_APPROVED,
  canShowUploadForm,
  canStartPicker,
  handleSubmitError,
  resolveUspsView,
} from "../src/lib/usps-compliance-state.js";

/** La forma real de GET /client/usps-compliance. */
function response(verification, record = {}) {
  return { record, verification };
}

const approved = response(
  {
    status: "APPROVED",
    approvedAt: "2026-09-12T15:00:00.000Z",
    uploadsAllowed: false,
    additionalDocumentsRequired: false,
    reviewReason: null,
    currentPlan: "PREMIUM",
    welcomeMessage: { notificationId: "n1", planCode: "PREMIUM", sentAt: "2026-09-12T15:00:00.000Z", readAt: null },
  },
  { status: "APPROVED", reviewedAt: "2020-01-01T00:00:00.000Z" }
);

test("1. APPROVED usa approvedAt como fecha principal", () => {
  const view = resolveUspsView(approved);
  assert.equal(view.approved, true);
  // No la reviewedAt del record, aunque exista.
  assert.equal(view.approvedAt, "2026-09-12T15:00:00.000Z");
});

test("1b. reviewedAt solo como respaldo cuando falta approvedAt", () => {
  const view = resolveUspsView(response({ status: "APPROVED", uploadsAllowed: false }, { reviewedAt: "2026-01-02T00:00:00.000Z" }));
  assert.equal(view.approvedAt, "2026-01-02T00:00:00.000Z");
});

test("2. uploadsAllowed=false no monta el formulario", () => {
  assert.equal(canShowUploadForm(resolveUspsView(approved)), false);
  // Tambien fuera de APPROVED: la capacidad la da el backend, no el estado.
  const blocked = resolveUspsView(response({ status: "UNDER_REVIEW", uploadsAllowed: false }));
  assert.equal(canShowUploadForm(blocked), false);
});

test("2b. un aprobado nunca permite subir aunque uploadsAllowed llegue en true", () => {
  const view = resolveUspsView(response({ status: "APPROVED", uploadsAllowed: true }));
  assert.equal(view.uploadsAllowed, false);
  assert.equal(canShowUploadForm(view), false);
});

test("2c. en revision con permiso si se muestra el formulario", () => {
  const view = resolveUspsView(response({ status: "SUBMITTED", uploadsAllowed: true, additionalDocumentsRequired: false }));
  assert.equal(canShowUploadForm(view), true);
});

test("3. APPROVED no permite abrir la camara", () => {
  assert.equal(canStartPicker(resolveUspsView(approved)), false);
});

test("4. APPROVED no permite el selector de archivos ni de imagenes", () => {
  // Camara, galeria y archivos cuelgan del mismo formulario: si no se monta,
  // ninguno de los tres existe.
  const view = resolveUspsView(approved);
  assert.equal(canStartPicker(view), canShowUploadForm(view));
  assert.equal(canStartPicker(view), false);
});

test("5. el 409 FORM_1583_ALREADY_APPROVED recarga sin mostrar un error generico", () => {
  const calls = { refetch: 0, clear: 0, error: 0 };
  const error = {
    response: {
      status: 409,
      data: {
        error: "Your USPS Form 1583 has already been approved. No additional documents are required.",
        code: FORM_1583_ALREADY_APPROVED,
      },
    },
  };

  const outcome = handleSubmitError(error, {
    refetch: () => calls.refetch++,
    clearSelection: () => calls.clear++,
    showError: () => calls.error++,
  });

  assert.equal(outcome, "approved");
  assert.deepEqual(calls, { refetch: 1, clear: 1, error: 0 });
});

test("5b. cualquier otro fallo si se muestra", () => {
  const calls = { refetch: 0, error: 0 };
  const outcome = handleSubmitError(
    { response: { status: 500, data: { error: "Internal server error" } } },
    { refetch: () => calls.refetch++, showError: () => calls.error++ }
  );
  assert.equal(outcome, "error");
  assert.deepEqual(calls, { refetch: 0, error: 1 });
});

test("sin ningun envio el estado es NOT_SUBMITTED y se puede subir", () => {
  const view = resolveUspsView(response({ status: "NOT_SUBMITTED", uploadsAllowed: true, additionalDocumentsRequired: true }, null));
  assert.equal(view.status, "NOT_SUBMITTED");
  assert.equal(canShowUploadForm(view), true);
});

test("el motivo de rechazo sale de reviewReason", () => {
  const view = resolveUspsView(response({ status: "REJECTED", uploadsAllowed: true, reviewReason: "ID is blurry" }));
  assert.equal(view.reviewReason, "ID is blurry");
});
