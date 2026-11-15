#!/usr/bin/env node
/**
 * Genera los ficheros que cada portal de miembros tiene que publicar para que
 * los enlaces de activacion (https://<portal>/set-password#token=...) abran la
 * app en vez del navegador:
 *
 *   /.well-known/apple-app-site-association   (iOS, Universal Links)
 *   /.well-known/assetlinks.json              (Android, App Links)
 *
 * No inventa nada: el Team ID de Apple y la huella SHA-256 del certificado de
 * firma de Android se pasan a mano (salen de Apple Developer y de
 * `eas credentials` / Play Console). Sin ellos, el script se niega.
 *
 * Uso:
 *   APPLE_TEAM_ID=ABCDE12345 ANDROID_SHA256=AA:BB:... node scripts/deep-link-files.js hdg [carpeta]
 *
 * Sin carpeta, escribe los dos JSON por pantalla. Con carpeta, deja
 * <carpeta>/<host>/.well-known/... listos para entregar al equipo del portal
 * (los portales son de otro equipo: la app no los publica).
 */

const fs = require("fs");
const path = require("path");

const { getBrand } = require("../brands");

const TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/;
const SHA256_PATTERN = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

function buildFiles(brand, { teamId, sha256 }) {
  if (!TEAM_ID_PATTERN.test(String(teamId || ""))) {
    throw new Error("APPLE_TEAM_ID falta o no es un Team ID de Apple (10 caracteres A-Z/0-9).");
  }
  const fingerprints = String(sha256 || "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  if (!fingerprints.length || !fingerprints.every((value) => SHA256_PATTERN.test(value))) {
    throw new Error("ANDROID_SHA256 falta o no es una huella SHA-256 (AA:BB:... 32 pares; varias separadas por comas).");
  }
  const paths = brand.appLinks?.paths?.length ? brand.appLinks.paths : ["/set-password"];
  const appId = teamId + "." + brand.bundleId;

  const appleAppSiteAssociation = {
    applinks: {
      details: [
        {
          appIDs: [appId],
          components: paths.map((p) => ({ "/": p, comment: "Account activation and password reset" })),
          // iOS < 13
          appID: appId,
          paths,
        },
      ],
    },
  };

  const assetLinks = [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: brand.bundleId, sha256_cert_fingerprints: fingerprints },
    },
  ];

  return { appleAppSiteAssociation, assetLinks };
}

function main() {
  const [brandId, outDir] = process.argv.slice(2);
  const brand = getBrand(brandId);
  const hosts = brand.appLinks?.hosts || [];
  if (!hosts.length) throw new Error(`${brand.id} no tiene appLinks.hosts en brands/index.js.`);

  const files = buildFiles(brand, { teamId: process.env.APPLE_TEAM_ID, sha256: process.env.ANDROID_SHA256 });

  if (!outDir) {
    process.stdout.write(JSON.stringify({ hosts, ...files }, null, 2) + "\n");
    return;
  }
  for (const host of hosts) {
    const dir = path.join(outDir, host, ".well-known");
    fs.mkdirSync(dir, { recursive: true });
    // Sin extension y servido como application/json, sin redirecciones.
    fs.writeFileSync(path.join(dir, "apple-app-site-association"), JSON.stringify(files.appleAppSiteAssociation, null, 2) + "\n");
    fs.writeFileSync(path.join(dir, "assetlinks.json"), JSON.stringify(files.assetLinks, null, 2) + "\n");
  }
  process.stdout.write(`Escritos en ${outDir} para: ${hosts.join(", ")}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(error.message + "\n");
    process.exit(1);
  }
}

module.exports = { buildFiles };
