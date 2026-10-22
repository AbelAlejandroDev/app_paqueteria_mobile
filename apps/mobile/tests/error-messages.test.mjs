import test from "node:test";
import assert from "node:assert/strict";

import { formatErrorMessage } from "../../../packages/core/src/utils.js";
import { loginErrorMessage } from "../src/lib/auth-messages.js";

const httpError = (status, data = {}) => ({ message: `Request failed with status code ${status}`, response: { status, data } });

test("Invalid body del backend no se enseña: se pide revisar los datos", () => {
  const error = httpError(400, { error: "Invalid body", details: {} });
  assert.equal(formatErrorMessage(error), "Please check the information you entered and try again.");
});

test("sin respuesta del servidor se habla de la conexion, no de Network Error", () => {
  assert.match(formatErrorMessage({ message: "Network Error" }), /couldn't reach the server/);
});

test("un 500 sin motivo legible es un fallo nuestro, no el texto de axios", () => {
  assert.match(formatErrorMessage(httpError(500, { error: "Internal Server Error" })), /on our side/);
  assert.match(formatErrorMessage(httpError(502)), /on our side/);
});

test("el motivo legible del servidor se respeta tal cual", () => {
  const error = httpError(409, { error: "Your scan request was rejected: wrong item" });
  assert.equal(formatErrorMessage(error), "Your scan request was rejected: wrong item");
});

test("sin nada util se usa el texto por defecto de la pantalla", () => {
  assert.equal(formatErrorMessage(httpError(404), "Unable to load"), "Unable to load");
});

test("en el login, un 400 (contraseña corta) es credenciales incorrectas", () => {
  assert.match(loginErrorMessage({ status: 400, code: "Invalid body", message: "Invalid body" }), /incorrect/);
  assert.doesNotMatch(loginErrorMessage({ status: 400, code: "Invalid body" }), /Invalid body/);
  assert.match(loginErrorMessage({ status: 500 }), /on our side/);
});
