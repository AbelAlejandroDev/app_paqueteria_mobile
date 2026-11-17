# TestFlight de My HDG Mail contra HDG Sandbox

Estado a 2026-11-17 (rama `feat/mobile-hdg-push-ios`). No se ha construido, enviado ni
publicado nada para iOS.

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
3. **Credenciales iOS en EAS** para el proyecto `hdg-client`: hoy ninguna
   (`iosAppCredentials: []`, comprobado 2026-11-17), y ninguna build iOS. La **clave APNs**
   se puede configurar antes de la build con `eas credentials -p ios` (pasos exactos y la
   cuestion de reutilizar la de The Worx: `docs/push-setup.md`, "APNs de HDG"). El primer
   `eas build` (interactivo, con Apple ID) crea el certificado de distribucion (o reutiliza
   el del equipo) y el perfil App Store del bundle id.
4. **Usuarios de TestFlight**: testers internos (miembros del equipo en App Store
   Connect) o un grupo externo (exige revision beta de Apple: descripcion, correo de
   contacto y una cuenta de prueba de HDG Sandbox para el revisor).
5. **Cuenta de prueba en HDG Sandbox** para los testers (y para la revision beta si es
   externa), activada (`set-password`) y sin datos reales.
6. **Backend de push en HDG Sandbox**: desplegar `feat/push-receipts-hardening`, permitir
   `exp.host` en la guardia de salida y el cron de `syncPushDelivery` (lo hace el VPS). Sin
   eso no sale ningun push del Sandbox, ni a Android ni a iOS.
7. Hecho: Firebase de HDG (`my-hdg-mail-f00be`, FCM v1 en EAS), Conference Room y
   politica de privacidad de HDG (`https://www.hdgexecutivesuites.com/privacy-policy/`,
   tambien para la ficha de App Store Connect).

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
