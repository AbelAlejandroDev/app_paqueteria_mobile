import test from "node:test";
import assert from "node:assert/strict";

import { isPublicAuthRequest } from "../../../packages/core/src/api.js";

test("el login y las demas rutas sin sesion no cierran la sesion con su 401", () => {
  assert.equal(isPublicAuthRequest("/auth/login"), true);
  assert.equal(isPublicAuthRequest("auth/login"), true);
  assert.equal(isPublicAuthRequest("/auth/refresh"), true);
  assert.equal(isPublicAuthRequest("/auth/set-password"), true);
  assert.equal(isPublicAuthRequest("/auth/forgot-password"), true);
});

test("tambien si la URL llega completa o con parametros", () => {
  assert.equal(isPublicAuthRequest("https://core.theworxoffices.com/api/v1/auth/login"), true);
  assert.equal(isPublicAuthRequest("/auth/login?x=1"), true);
});

test("el resto si sigue el camino de renovar la sesion", () => {
  assert.equal(isPublicAuthRequest("/auth/me"), false);
  assert.equal(isPublicAuthRequest("/client/mail-items"), false);
  assert.equal(isPublicAuthRequest(undefined), false);
});
