# Persistencia de la sesion y `keepLoggedIn`

Estado a 2026-11-13 (rama `feat/mobile-fase-2-3`). Solo documenta; no cambia nada.

## Lo que hace hoy la app

- **Tokens** (`accessToken`, `refreshToken`): `expo-secure-store` (Keychain en iOS,
  Keystore en Android), via `packages/core/src/storage.js` y `src/lib/storage.js`.
  **Siempre se guardan** y sobreviven al cierre de la app.
- **Usuario** (`authUser`): AsyncStorage. Se borra junto a los tokens (logout,
  sesion revocada). Ver `tests/session-cache.test.mjs`.
- La sesion solo se cierra por: el boton de logout, un rechazo inequivoco del
  servidor (401 del refresh, `SESSION_REVOKED`, 400 "Invalid body" del refresh,
  404 "User not found" en `/auth/me`). Sin red, timeout, 429 o 5xx **no** la
  cierran (fase 1, `packages/core/src/session.js`).

## `keepLoggedIn`

`src/lib/security-preferences.js` declara `keepLoggedIn: true` por defecto, con el
comentario "Apagarlo borra las credenciales al cerrar la app". **Eso no ocurre**:

- Ninguna pantalla lo ofrece: `settings/security.jsx` solo muestra el interruptor
  de `requireBiometrics`.
- Nada lo lee: ni `AuthContext`, ni el arranque, ni `biometric-gate.jsx`
  (que solo mira `requireBiometrics`).
- Por tanto, el valor guardado es siempre `true` (o falta y vale el defecto), y
  las credenciales persisten siempre.

Es una preferencia sin efecto. `tests/session-persistence.test.mjs` fija este
comportamiento, para que activarlo sea una decision explicita y no un efecto
secundario.

## Si se quisiera activar (decision pendiente, no implementado)

Hace falta una decision de seguridad y pruebas especificas, porque:

1. "Al cerrar la app" no tiene un evento fiable en iOS/Android (un proceso
   matado no avisa). Lo habitual es borrar al **arrancar** si la preferencia es
   `false`, o guardar los tokens solo en memoria.
2. Hay que decidir que pasa con el push: si se borran los tokens sin
   `push-devices/unregister`, el dispositivo sigue recibiendo avisos de la cuenta
   hasta que el backend lo limpie.
3. Interaccion con el bloqueo biometrico (`requireBiometrics`), que hoy es la
   proteccion del dispositivo ya disponible.
4. Pruebas: arranque con `false` (sin tokens), arranque con `true`, cambio de
   preferencia con sesion abierta, logout, y que nada lo active por defecto.

Recomendacion: mientras no se decida, quitar el comentario engañoso o la clave,
en un cambio aparte y con su test.
