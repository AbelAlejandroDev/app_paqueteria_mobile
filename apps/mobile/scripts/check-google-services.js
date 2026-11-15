#!/usr/bin/env node
/**
 * Comprueba el google-services.json de cada marca (Firebase, push en Android).
 *
 *   node scripts/check-google-services.js
 *
 * Por marca, si el fichero existe (assets/brands/<id>/google-services.json):
 *   - es JSON de Firebase (project_info, client[]);
 *   - TODOS sus clientes Android son del application id de esa marca;
 *   - su proyecto de Firebase no es el de otra marca (HDG nunca puede usar
 *     `the-worx-client`: sus pushes irian por el proyecto de The Worx).
 * Si no existe, lo dice: la app de esa marca no registra push en Android.
 *
 * No imprime claves. El fichero es de identificadores publicos; la clave privada
 * de la cuenta de servicio (FCM v1) va en EAS, nunca aqui.
 */
const fs = require("fs");
const path = require("path");

const { BRANDS } = require("../brands");

const APP_DIR = path.dirname(require.resolve("../package.json"));

function googleServicesPath(brandId) {
  return path.join(APP_DIR, "assets", "brands", brandId, "google-services.json");
}

function readGoogleServices(brandId) {
  const file = googleServicesPath(brandId);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Problemas del fichero de una marca ([] si esta bien o si no existe). */
function googleServicesProblems(brandId, { read = readGoogleServices, brands = BRANDS } = {}) {
  const brand = brands[brandId];
  const config = read(brandId);
  if (!config) return [];

  const problems = [];
  const projectId = config?.project_info?.project_id;
  if (!projectId) problems.push("sin project_info.project_id");
  const clients = Array.isArray(config?.client) ? config.client : [];
  if (!clients.length) problems.push("sin client[]");

  const packages = clients.map((c) => c?.client_info?.android_client_info?.package_name).filter(Boolean);
  if (!packages.includes(brand.bundleId)) problems.push(`no tiene el application id ${brand.bundleId}`);
  for (const pkg of packages) {
    if (pkg !== brand.bundleId) problems.push(`trae otra app (${pkg}): solo debe estar ${brand.bundleId}`);
  }
  for (const client of clients) {
    if (!client?.client_info?.mobilesdk_app_id) problems.push("un cliente sin mobilesdk_app_id");
    if (!Array.isArray(client?.api_key) || !client.api_key.length) problems.push("un cliente sin api_key");
  }

  for (const other of Object.values(brands)) {
    if (other.id === brandId) continue;
    const otherConfig = read(other.id);
    if (otherConfig?.project_info?.project_id && otherConfig.project_info.project_id === projectId) {
      problems.push(`usa el proyecto de Firebase de ${other.id} (${projectId})`);
    }
  }
  return problems;
}

function main() {
  let failed = false;
  for (const brand of Object.values(BRANDS)) {
    const config = readGoogleServices(brand.id);
    if (!config) {
      process.stdout.write(`${brand.id}: sin google-services.json -> Android no registra push.\n`);
      continue;
    }
    const problems = googleServicesProblems(brand.id);
    if (problems.length) {
      failed = true;
      process.stdout.write(`${brand.id}: MAL\n  - ${problems.join("\n  - ")}\n`);
    } else {
      process.stdout.write(`${brand.id}: ok (proyecto ${config.project_info.project_id}, ${brand.bundleId})\n`);
    }
  }
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main();

module.exports = { googleServicesPath, googleServicesProblems, readGoogleServices };
