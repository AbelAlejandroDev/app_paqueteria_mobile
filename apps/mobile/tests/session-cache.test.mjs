import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QueryClient } from "@tanstack/query-core";

import { createScopeTracker, resetQueryCache, scopeChangeRequiresReset, sessionScope } from "../src/lib/session-scope.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const anaWorx = { id: "ana", tenantId: "worx", role: "CLIENT" };
const anaHdg = { id: "ana", tenantId: "hdg", role: "CLIENT" };
const bob = { id: "bob", tenantId: "worx", role: "CLIENT" };

test("el ambito separa usuarios y organizaciones", () => {
  assert.equal(sessionScope(anaWorx), "worx:ana");
  assert.notEqual(sessionScope(anaWorx), sessionScope(anaHdg));
  assert.notEqual(sessionScope(anaWorx), sessionScope(bob));
  assert.equal(sessionScope({ id: "ana", tenant: { slug: "hdg" } }), "hdg:ana");
  assert.equal(sessionScope(null), null);
  assert.equal(sessionScope({}), null);
});

test("cuando hay que vaciar: cerrar sesion, otro usuario, otro tenant; no en el arranque ni con el mismo", () => {
  assert.equal(scopeChangeRequiresReset(undefined, "worx:ana"), false, "arranque con usuario guardado");
  assert.equal(scopeChangeRequiresReset(undefined, null), false, "arranque sin sesion");
  assert.equal(scopeChangeRequiresReset("worx:ana", "worx:ana"), false, "refresh del mismo usuario");
  assert.equal(scopeChangeRequiresReset("worx:ana", null), true, "cerrar sesion");
  assert.equal(scopeChangeRequiresReset("worx:ana", "worx:bob"), true, "otro usuario");
  assert.equal(scopeChangeRequiresReset("worx:ana", "hdg:ana"), true, "otro tenant");
  assert.equal(scopeChangeRequiresReset(null, "worx:bob"), true, "entrar tras un cierre");
});

function clientWithData(user) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(["client-forwarding-addresses"], [{ id: "addr-" + user.id, name: user.id }]);
  queryClient.setQueryData(["client-mail-items"], [{ id: "item-" + user.id }]);
  return queryClient;
}

test("cerrar sesion vacia la cache de React Query", () => {
  const queryClient = clientWithData(anaWorx);
  const resets = [];
  const track = createScopeTracker((next) => {
    resets.push(next);
    resetQueryCache(queryClient);
  });

  track(anaWorx);
  assert.equal(resets.length, 0);
  assert.ok(queryClient.getQueryData(["client-mail-items"]));

  track(null);
  assert.deepEqual(resets, [null]);
  assert.equal(queryClient.getQueryData(["client-mail-items"]), undefined);
  assert.equal(queryClient.getQueryData(["client-forwarding-addresses"]), undefined);
  assert.equal(queryClient.getQueryCache().getAll().length, 0);
});

test("otro usuario u otra organizacion no ve la cache del anterior", () => {
  for (const next of [bob, anaHdg]) {
    const queryClient = clientWithData(anaWorx);
    const track = createScopeTracker(() => resetQueryCache(queryClient));
    track(anaWorx);
    track(next);
    assert.equal(queryClient.getQueryCache().getAll().length, 0, sessionScope(next));
  }
});

test("el refresh del mismo usuario no vacia la cache", () => {
  const queryClient = clientWithData(anaWorx);
  const track = createScopeTracker(() => resetQueryCache(queryClient));
  track(anaWorx);
  track({ ...anaWorx, firstName: "Ana" });
  assert.ok(queryClient.getQueryData(["client-mail-items"]));
});

test("una respuesta en vuelo de la cuenta anterior no aparece en la cache de la siguiente", async () => {
  const queryClient = new QueryClient();
  const track = createScopeTracker(() => resetQueryCache(queryClient));
  track(anaWorx);

  let resolveFetch;
  const inFlight = queryClient
    .fetchQuery({
      queryKey: ["client-mail-items"],
      queryFn: () => new Promise((resolve) => (resolveFetch = resolve)),
      retry: false,
    })
    .catch(() => null);

  // Ana cierra sesion y entra Bob antes de que llegue la respuesta.
  track(null);
  track(bob);
  resolveFetch([{ id: "item-ana", private: true }]);
  await inFlight;

  assert.equal(queryClient.getQueryData(["client-mail-items"]), undefined);
});

test("AuthContext: todo cambio de usuario pasa por el tracker y vacia React Query", () => {
  const source = read("src/context/AuthContext.jsx");
  assert.match(source, /createScopeTracker\(\(nextScope\) => \{\s*resetQueryCache\(queryClient\);\s*\/\/[^\n]*\n\s*clearPendingNavigation\(\);/);
  // Un solo setUser, dentro de applyUser, despues de trackScope.
  assert.equal((source.match(/setUser\(/g) || []).length, 1);
  // (entre medias, setPushSessionActive: sin sesion no se enseñan avisos con la app delante)
  assert.match(source, /trackScope\(nextUser\);\s*(\/\/[^\n]*\n\s*)?setPushSessionActive\(Boolean\(nextUser\)\);\s*setUser\(nextUser \?\? null\);/);
  // Logout, sesion invalida y el aviso del cliente HTTP (sesion revocada) pasan por ahi.
  assert.match(source, /finally \{\s*\/\/[^\n]*\n\s*await endLocalSession\(\);/);
  assert.match(source, /on\(AUTH_USER_UPDATED_EVENT, \(nextUser\) => \{[\s\S]*?applyUser\(nextUser \?\? null\);/);
});

test("AsyncStorage: lo guardado es por cuenta o se borra al salir", () => {
  // El usuario guardado (datos personales) se borra junto a los tokens.
  const auth = read("src/context/AuthContext.jsx");
  const end = auth.match(/const endLocalSession = useCallback\([\s\S]*?\n  \}, \[applyUser\]\);/)[0];
  assert.match(end, /clearTokens\(\)/);
  assert.match(end, /clearAuthUser\(\)/);
  // El tutorial va por organizacion y usuario; los terminos, por usuario.
  assert.match(read("src/lib/onboarding-state.js"), /user\.tenantId \|\| user\.tenant\?\.id/);
  assert.match(read("src/lib/terms-state.js"), /\[userId\]: true/);
  // Ninguna otra clave de AsyncStorage guarda datos de la cuenta.
  const keys = [];
  for (const file of fs.readdirSync(path.join(root, "src/lib"))) {
    const source = read("src/lib/" + file);
    if (/setJsonValue\(/.test(source)) keys.push(file);
  }
  // push-notifications: solo la marca "falta invalidar el token en este
  // dispositivo" tras un logout sin red (una fecha, ningun dato de la cuenta).
  assert.deepEqual(keys.sort(), ["onboarding-state.js", "push-notifications.js", "security-preferences.js", "terms-state.js"]);
  assert.match(read("src/lib/push-notifications.js"), /setJsonValue\(PUSH_LOCAL_UNREGISTER_PENDING_KEY, \{ at: new Date\(\)\.toISOString\(\) \}\)/);
});
