import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(jsx?|tsx?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test("ningun texto de la interfaz lleva la raya larga (—)", () => {
  for (const file of sourceFiles(path.join(root, "src"))) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      const code = line.trim();
      // Los comentarios pueden llevarla; lo que ve el cliente, no.
      if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
      assert.doesNotMatch(line, /—/, `${path.relative(root, file)}:${index + 1}`);
    });
  }
});

test("Forward usa la direccion de reenvio guardada como predeterminada y la ensena", () => {
  const screen = read("src/app/(client)/mail-items/[id].jsx");
  assert.doesNotMatch(screen, /clientProfile/, "el perfil del cliente no es una direccion de reenvio");
  assert.match(screen, /api\.get\("\/client\/forwarding-addresses"\)/);
  assert.match(screen, /queryKey: \["client-forwarding-addresses"\]/, "la misma cache que Settings");
  assert.match(screen, /\.find\(\(address\) => address\?\.isDefault\)/);
  assert.match(screen, /Your default address/);
  assert.match(screen, /Use this address/);
  assert.doesNotMatch(screen, /Use my default address/);
  // Settings lee la misma clave y el mismo campo `items`.
  const settings = read("src/app/(client)/settings/forwarding-addresses.jsx");
  assert.match(settings, /const QUERY_KEY = \["client-forwarding-addresses"\]/);
  assert.match(settings, /\.data\?\.items \|\| \[\]/);
});
