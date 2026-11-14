/**
 * Si se avisa de que esto es un entorno de pruebas (Sandbox).
 *
 * Dos fuentes reales:
 *   - `apiEnvironment`: el entorno de la build, validado al construirla
 *     (brands/api-environment.js, extra.api.environment). HDG Sandbox es
 *     "sandbox"; The Worx es "production".
 *   - `deployment`: lo que dice el servidor. El backend solo lo publica en
 *     GET /public/portal (`deployment: "sandbox"` en un proceso de pruebas; en
 *     produccion el campo no existe). Llega a la app por las capacidades; null
 *     si no se conoce (ver docs/backend-contract-gaps.md).
 *
 * Basta con que una de las dos diga sandbox. Si la build es de production y el
 * servidor dice sandbox, se avisa igual y se marca como discrepancia: es
 * justo lo que no deberia pasar nunca.
 */
export function sandboxIndicator({ apiEnvironment, deployment } = {}) {
  const buildSandbox = apiEnvironment === "sandbox";
  const serverSandbox = deployment === "sandbox";

  if (!buildSandbox && !serverSandbox) return { visible: false, label: null, mismatch: false };

  const mismatch = apiEnvironment === "production" && serverSandbox;
  return {
    visible: true,
    mismatch,
    label: mismatch
      ? "Test server: this production app is connected to a sandbox environment."
      : "Sandbox: test environment. Data and payments here are not real.",
  };
}
