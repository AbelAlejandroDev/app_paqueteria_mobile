/**
 * React Native no tiene "foco de ventana": React Query no sabe cuando la app
 * vuelve a primer plano. Esto se lo cuenta con AppState, para que las consultas
 * caducadas (las capacidades, entre ellas) se vuelvan a pedir al volver.
 *
 * Solo relee consultas (GET). Las mutaciones no se repiten nunca.
 */
export function connectFocusToAppState(focusManager, AppState) {
  focusManager.setEventListener((handleFocus) => {
    const subscription = AppState.addEventListener("change", (state) => handleFocus(state === "active"));
    return () => subscription.remove();
  });
}
