# TestFlight de My HDG Mail contra HDG Sandbox

Estado a 2026-11-14 (rama `feat/mobile-fase-4`). Revisado en solo lectura: no se ha
construido, enviado ni publicado nada.

## Lo que ya esta

| Pieza | Valor | Comprobado |
|---|---|---|
| Cuenta / proyecto EAS | `@ab-estrategia-360/hdg-client`, id `2e12104c-c190-48aa-b044-da110d34e8f1` | `eas project:info` |
| Sesion EAS en este equipo | `alejandrogenesisdma` (Owner de `ab-estrategia-360`) | `eas whoami` |
| Nombre / bundle id | `My HDG Mail` / `com.hdgexecutivesuites.clientportal` | `eas config --profile hdg-testflight-sandbox --platform ios` |
| Perfil de build | `hdg-testflight-sandbox`: `distribution: store`, `autoIncrement`, canal OTA `testflight-sandbox`, entorno EAS `preview`, `APP_ENV=sandbox`, API `https://core.hdgexecutivesuites.com/api/v1` | `eas config` + `tests/build-safety.test.mjs` |
| Runtime OTA | `native-3` (igual que The Worx); un OTA del canal `production` nunca le llega | `app.config.js` |
| iOS | `usesNonExemptEncryption: false`; textos de Face ID, camara y fotos; sin microfono; sin iPad | `app.config.js` |
| Push | `expo-notifications` con `projectId` de HDG (no comparte proyecto con The Worx) | `app.config.js`, `brands/index.js` |
| Login | `tenantSlug: "hdg"`; organizacion resuelta en HDG Sandbox (comprobado con una cuenta ficticia: 401 credenciales, no 400) | `tests/login-tenant.test.mjs` |
| Production comercial | `hdg-production` sigue **bloqueado** (sin API de produccion ni autorizacion) | `tests/build-safety.test.mjs` |

## Lo que falta (en orden)

1. **App en App Store Connect** para `com.hdgexecutivesuites.clientportal`
   (nombre "My HDG Mail"). Hace falta saber **en que equipo de Apple Developer** va:
   el de The Worx (el que firma `com.theworxoffices.clientportal`) u otro de HDG. Quien
   la cree necesita rol Admin o App Manager en ese equipo.
2. **`ascAppId`** de esa app → añadir en `eas.json`:
   `"submit": { "hdg-testflight-sandbox": { "ios": { "ascAppId": "<id>" } } }`.
   Hoy no existe a proposito (un test lo comprueba).
3. **Credenciales iOS en EAS** para el proyecto `hdg-client`: no hay ninguna build de iOS
   (ni de Android) de HDG en EAS, asi que no hay perfil de aprovisionamiento. El primer
   `eas build` las crea si se inicia sesion con Apple (interactivo): certificado de
   distribucion (se puede reutilizar el del equipo), perfil App Store del bundle id y
   **clave APNs** (sin ella no llegan los push en iOS).
4. **Usuarios de TestFlight**: testers internos (miembros del equipo en App Store
   Connect) o un grupo externo (exige revision beta de Apple: descripcion, correo de
   contacto y una cuenta de prueba de HDG Sandbox para el revisor).
5. **Cuenta de prueba en HDG Sandbox** para los testers (y para la revision beta si es
   externa), activada (`set-password`) y sin datos reales.
6. Android (no es TestFlight, pero va junto): `assets/brands/hdg/google-services.json`
   (proyecto Firebase de HDG) para push; sin el, el registro push falla en Android.

## Como se construiria (cuando se autorice; NO ejecutado)

```bash
cd apps/mobile
APP_BRAND=hdg APP_ENV=sandbox EXPO_PUBLIC_API_URL=https://core.hdgexecutivesuites.com/api/v1 \
  npx eas-cli build --profile hdg-testflight-sandbox --platform ios
# despues, con el ascAppId en eas.json:
npx eas-cli submit --profile hdg-testflight-sandbox --platform ios
```

Lanzarlo desde `D:\` (mayuscula) en Windows: con `d:\` Metro no resuelve `@paqueteria/core`.

## Riesgo a vigilar

Una build de TestFlight es una build de tienda: **no debe enviarse a revision de App
Store**. Apunta a HDG Sandbox (datos y pagos de prueba) y enseña la franja "Sandbox".
La version comercial de HDG saldra de `hdg-production`, que sigue bloqueado hasta tener su
API de produccion y la autorizacion del lanzamiento.
