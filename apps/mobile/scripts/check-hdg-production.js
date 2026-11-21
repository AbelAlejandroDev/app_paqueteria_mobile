#!/usr/bin/env node
/**
 * Freno de las builds de HDG Production mientras `core` siga siendo Sandbox.
 *
 *   node scripts/check-hdg-production.js              # comprueba HDG Production
 *   (hook de EAS "eas-build-pre-install": solo actua con APP_BRAND=hdg APP_ENV=production)
 *
 * Por que: el backend (feat/hdg-production-supabase, 3078f4e,
 * docs/HDG_MOBILE_PRODUCTION_HANDOFF.md §1-2) deja `core.hdgexecutivesuites.com`
 * sirviendo HDG Sandbox hasta que el propietario promueve Production. Una build
 * de App Store hecha antes hablaria con Sandbox. La senal publica para saberlo:
 * `GET /public/portal` devuelve `"deployment": "sandbox"` en Sandbox y en
 * Production el campo no existe. Sin `Origin` de un portal la ruta no resuelve
 * el tenant, por eso se manda el del portal de miembros de Production.
 *
 * Solo hace un GET publico: no inicia sesion, no escribe nada y no imprime nada
 * secreto. Ante la duda (red, 5xx, JSON raro) frena: mejor una build parada que
 * una de App Store contra Sandbox.
 */
const { BRANDS } = require("../brands");

const TIMEOUT_MS = 15000;

/**
 * El veredicto, sin red: `{ ok, message }`.
 * @param {{ status?: number, body?: unknown, error?: string }} result
 */
function productionVerdict({ status, body, error } = {}) {
  if (error) return { ok: false, message: `No se pudo comprobar HDG Production (${error}).` };
  if (status !== 200 || !body || typeof body !== "object") {
    return { ok: false, message: `public/portal respondio ${status ?? "sin estado"}: no se puede confirmar que sea Production.` };
  }
  if (body.error) return { ok: false, message: `public/portal respondio un error (${String(body.error)}).` };
  if (Object.prototype.hasOwnProperty.call(body, "deployment")) {
    return {
      ok: false,
      message: `core.hdgexecutivesuites.com sigue siendo HDG ${String(body.deployment)} (deployment presente). Production no se ha promovido.`,
    };
  }
  const tenant = String(body?.tenant?.slug || "").toLowerCase();
  if (tenant !== BRANDS.hdg.tenantSlug) {
    return { ok: false, message: `public/portal no es de HDG (tenant "${tenant || "?"}").` };
  }
  return { ok: true, message: "core.hdgexecutivesuites.com es HDG Production (public/portal sin deployment, tenant hdg)." };
}

/** Si esta build tiene que pasar el freno: solo HDG y production. */
function appliesTo(env = process.env) {
  return String(env.APP_BRAND || "").trim() === "hdg" && String(env.APP_ENV || "").trim().toLowerCase() === "production";
}

async function checkProduction({ fetchImpl = fetch } = {}) {
  const { portalUrl, origin } = BRANDS.hdg.productionRelease.productionCheck;
  try {
    const response = await fetchImpl(portalUrl, {
      headers: { Origin: origin, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return productionVerdict({ status: response.status, body });
  } catch (error) {
    return productionVerdict({ error: error?.name === "TimeoutError" ? "timeout" : error?.message || "error de red" });
  }
}

async function main() {
  // Como hook de EAS corre en TODAS las builds: solo frena las de HDG Production.
  if (process.env.EAS_BUILD && !appliesTo()) return;
  const verdict = await checkProduction();
  process.stdout.write((verdict.ok ? "OK: " : "FRENADO: ") + verdict.message + "\n");
  // exitCode y no process.exit(): con la conexion HTTP aun abierta, salir de
  // golpe hace fallar un assert de libuv en Windows (Node 24).
  if (!verdict.ok) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { appliesTo, checkProduction, productionVerdict };
