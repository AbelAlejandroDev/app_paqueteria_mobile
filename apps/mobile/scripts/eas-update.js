#!/usr/bin/env node
/**
 * Publicar un EAS Update sin cruzar marcas ni entornos (brands/update-channels).
 *
 *   node scripts/eas-update.js <marca> <canal> --message "que cambia"          # solo enseña el plan
 *   node scripts/eas-update.js <marca> <canal> --message "que cambia" --run    # lo ejecuta
 *
 * Sin --run no publica nada: imprime las variables y el comando. Lanzar desde
 * apps/mobile y, en Windows, desde D:\ (mayuscula) por Metro.
 */
const { spawnSync } = require("child_process");
const eas = require("../eas.json");
const { updatePlan } = require("../brands/update-channels");

function parse(argv) {
  const [brandId, channel, ...rest] = argv;
  const messageIndex = rest.indexOf("--message");
  return { brandId, channel, message: messageIndex >= 0 ? rest[messageIndex + 1] : null, run: rest.includes("--run") };
}

function main() {
  const { brandId, channel, message, run } = parse(process.argv.slice(2));
  const plan = updatePlan({ brandId, channel, eas, message });
  const printable = Object.entries(plan.env).map(([k, v]) => `${k}=${v}`).join(" ") + " " + [plan.command, ...plan.args].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ");
  if (!run) {
    process.stdout.write("Plan (no se ha publicado nada):\n  " + printable + "\n");
    return;
  }
  const result = spawnSync(plan.command, plan.args, { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...plan.env } });
  process.exit(result.status ?? 1);
}

try {
  main();
} catch (error) {
  process.stderr.write(error.message + "\n");
  process.exit(1);
}
