import test from "node:test";
import assert from "node:assert/strict";

import {
  forgotPasswordOutcome,
  loginErrorMessage,
  passwordProblem,
  retryAfterSeconds,
  sessionEndedMessage,
} from "../src/lib/auth-messages.js";

test("el login dice que las credenciales no valen, y distingue la red", () => {
  assert.match(loginErrorMessage({ status: 401, code: "Invalid credentials" }), /incorrect/);
  assert.match(loginErrorMessage({ network: true }), /couldn't reach the server/);
  assert.match(loginErrorMessage({ status: 429 }), /Too many/);
});

test("pedir el enlace no revela si la cuenta existe", () => {
  const sent = forgotPasswordOutcome(null);
  assert.equal(sent.kind, "sent");
  assert.match(sent.message, /If an account exists/);
});

test("sin el endpoint en el backend no se finge que se envio", () => {
  assert.equal(forgotPasswordOutcome({ response: { status: 404 } }).kind, "unavailable");
});

test("limite de intentos, red y correo invalido tienen su mensaje", () => {
  assert.match(forgotPasswordOutcome({ response: { status: 429 } }).message, /Too many/);
  assert.match(forgotPasswordOutcome({}).message, /couldn't reach/);
  assert.match(forgotPasswordOutcome({ response: { status: 400 } }).message, /valid email/);
});

test("la contraseña nueva: largo, letra y numero, y sin el correo", () => {
  assert.match(passwordProblem("abc12"), /at least 8/);
  assert.match(passwordProblem("a".repeat(73) + "1"), /72/);
  assert.match(passwordProblem("onlyletters"), /letter and one number/);
  assert.match(passwordProblem("12345678"), /letter and one number/);
  assert.match(passwordProblem("abel2024x", "abel@example.com"), /email/);
  assert.equal(passwordProblem("Mailbox2026"), null);
});

test("el 429 usa la espera que manda el backend, del cuerpo o de Retry-After", () => {
  const fromBody = forgotPasswordOutcome({ response: { status: 429, data: { retryAfterSeconds: 1234 } } });
  assert.equal(fromBody.retryAfter, 1234);
  assert.match(fromBody.message, /21 minutes/);

  assert.equal(retryAfterSeconds({ headers: { "retry-after": "90" } }), 90);
  assert.equal(retryAfterSeconds({ data: {}, headers: {} }), 0);
  assert.match(forgotPasswordOutcome({ response: { status: 429, data: { retryAfterSeconds: 30 } } }).message, /1 minute./);
});

test("la sesion revocada por cambio de contraseña se explica en el login", () => {
  assert.match(sessionEndedMessage("SESSION_REVOKED"), /password was changed/);
  assert.equal(sessionEndedMessage(""), "");
  assert.equal(sessionEndedMessage("OTHER"), "");
});
