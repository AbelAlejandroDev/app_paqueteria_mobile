/**
 * Si se avisa de que esto es un entorno de pruebas (Sandbox).
 *
 * Dos fuentes reales:
 *   - `serverEnvironment`: `environment` de GET /client/capabilities
 *     ("sandbox" | "production" | "unspecified"), que sale de APP_DEPLOYMENT en
 *     el servidor. Es la que manda (contrato v1 §4.5: "Sandbox solo si
 *     environment === 'sandbox'"). Solo existe con sesion.
 *   - `apiEnvironment`: el entorno de la build (extra.api.environment), validado
 *     al construirla. Antes del login (sin capacidades) es lo unico que hay:
 *     una build de HDG Sandbox enseña la franja tambien en el login.
 *
 * "unspecified" (desarrollo local del backend) no es sandbox ni production:
 * se sigue la build. Si build y servidor no coinciden se avisa en rojo: es
 * justo lo que no deberia pasar nunca.
 */
export function sandboxIndicator({ apiEnvironment, serverEnvironment } = {}) {
  const hidden = { visible: false, label: null, mismatch: false };

  if (serverEnvironment === "sandbox") {
    const mismatch = apiEnvironment === "production";
    return {
      visible: true,
      mismatch,
      label: mismatch
        ? "Test server: this production app is connected to a sandbox environment."
        : "Sandbox: test environment. Data and payments here are not real.",
    };
  }

  if (serverEnvironment === "production") {
    if (apiEnvironment !== "sandbox") return hidden;
    return { visible: true, mismatch: true, label: "Warning: this test app is connected to a production server." };
  }

  if (apiEnvironment === "sandbox") {
    return { visible: true, mismatch: false, label: "Sandbox: test environment. Data and payments here are not real." };
  }
  return hidden;
}
