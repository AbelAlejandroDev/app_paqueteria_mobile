#!/usr/bin/env node
/**
 * Comprueba que HDG Production publica sus enlaces legales desde el backend.
 *
 *   npm run check:hdg-legal            # Production (core)
 *   npm run check:hdg-legal -- sandbox # Sandbox (sandbox-core)
 *
 * Por que: la app enseña la politica de privacidad y la pagina de borrado de la
 * marca cuando el backend dice null (lib/legal-links). Eso evita una pantalla
 * sin politica, pero tambien taparia que Production no esta configurado. Este
 * script lo hace visible antes de construir: tiene que responder OK.
 *
 * El backend (src/config/legalLinks.js) no tiene valor por defecto: sale null
 * mientras falten PRIVACY_POLICY_URL__HDG y ACCOUNT_DELETION_URL__HDG en su
 * entorno, y un backend anterior a 0497bab ni siquiera manda
 * `accountDeletionUrl`.
 *
 * Solo hace un GET publico (`/public/legal?tenant=hdg`): sin sesion, sin
 * escribir nada. Cualquier duda (red, 5xx, campo que falta) es FALLO.
 */
const { BRANDS } = require("../brands");

const TIMEOUT_MS = 15000;

function normalizeUrl(value) {
  try {
    const url = new URL(String(value));
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * El veredicto, sin red.
 * @param {{ status?: number, body?: any, error?: string }} result
 * @param {{ tenantSlug: string, privacyPolicy?: { url: string }, accountDeletion?: { url: string } }} brand
 */
function legalVerdict({ status, body, error } = {}, brand = BRANDS.hdg) {
  if (error) return { ok: false, problems: [`No se pudo consultar /public/legal (${error}).`] };
  if (status !== 200 || !body || typeof body !== "object") {
    return { ok: false, problems: [`/public/legal respondio ${status ?? "sin estado"}.`] };
  }
  const problems = [];
  if (String(body.tenant || "").toLowerCase() !== brand.tenantSlug) problems.push(`tenant "${body.tenant}" en vez de "${brand.tenantSlug}".`);

  const expect = [
    ["privacyPolicyUrl", "PRIVACY_POLICY_URL__HDG", brand.privacyPolicy?.url],
    ["accountDeletionUrl", "ACCOUNT_DELETION_URL__HDG", brand.accountDeletion?.url],
  ];
  for (const [field, envVar, published] of expect) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) {
      problems.push(`falta ${field}: el backend desplegado es anterior al que lo devuelve (0497bab).`);
      continue;
    }
    if (body[field] === null) {
      problems.push(`${field} es null: falta ${envVar} en el entorno del backend.`);
      continue;
    }
    const got = normalizeUrl(body[field]);
    if (!got || !got.startsWith("https://")) problems.push(`${field} no es una URL https (${body[field]}).`);
    else if (published && got !== normalizeUrl(published)) problems.push(`${field} es ${got}; la publicada por HDG es ${published}.`);
  }
  return { ok: problems.length === 0, problems };
}

async function checkLegal({ environment = "production", fetchImpl = fetch } = {}) {
  const base = BRANDS.hdg.api[environment];
  if (!base) return { ok: false, problems: [`HDG no tiene entorno "${environment}".`] };
  const url = base + "/public/legal?tenant=" + BRANDS.hdg.tenantSlug;
  try {
    const response = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { url, ...legalVerdict({ status: response.status, body }) };
  } catch (error) {
    return { url, ...legalVerdict({ error: error?.name === "TimeoutError" ? "timeout" : error?.message || "error de red" }) };
  }
}

async function main() {
  const environment = process.argv[2] === "sandbox" ? "sandbox" : "production";
  const verdict = await checkLegal({ environment });
  if (verdict.ok) {
    process.stdout.write(`OK: ${verdict.url} devuelve la politica de privacidad y el borrado de cuenta de HDG.\n`);
    return;
  }
  process.stdout.write(`FALLO: ${verdict.url}\n` + verdict.problems.map((p) => `  - ${p}\n`).join(""));
  // exitCode y no process.exit(): ver check-hdg-production.js (Node 24 en Windows).
  process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { checkLegal, legalVerdict };
