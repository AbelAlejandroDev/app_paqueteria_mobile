# TestFlight de My HDG Mail contra HDG Sandbox

Estado a 2026-11-17 (rama `feat/mobile-hdg-push-ios`). No se ha construido, enviado ni
publicado nada para iOS.

## Lo que ya esta

| Pieza | Valor | Comprobado |
|---|---|---|
| Cuenta / proyecto EAS | `@ab-estrategia-360/hdg-client`, id `2e12104c-c190-48aa-b044-da110d34e8f1` | `eas project:info` |
| Sesion EAS en este equipo | `alejandrogenesisdma` (Owner de `ab-estrategia-360`) | `eas whoami` |
| Nombre / bundle id | `My HDG Mail` / `com.hdgexecutivesuites.clientportal` | `eas config --profile hdg-testflight-sandbox --platform ios` |
| Perfil de build | `hdg-testflight-sandbox`: `distribution: store`, `autoIncrement`, canal OTA `testflight-sandbox`, entorno EAS `preview`, `APP_ENV=sandbox`, API `https://sandbox-core.hdgexecutivesuites.com/api/v1` (desde 2026-11-21; antes `core`, que pasa a ser Production) | `eas config` + `tests/build-safety.test.mjs` |
| Runtime OTA | `native-3` (igual que The Worx); un OTA del canal `production` nunca le llega | `app.config.js` |
| iOS | `usesNonExemptEncryption: false`; textos de Face ID, camara y fotos; sin microfono; sin iPad | `app.config.js` |
| Push | `expo-notifications` con `projectId` de HDG (no comparte proyecto con The Worx) | `app.config.js`, `brands/index.js` |
| Login | `tenantSlug: "hdg"`; organizacion resuelta en HDG Sandbox (comprobado con una cuenta ficticia: 401 credenciales, no 400) | `tests/login-tenant.test.mjs` |
| Production | `hdg-production` contra `core.hdgexecutivesuites.com`: ver `docs/hdg-production-app-review.md` | `tests/build-safety.test.mjs`, `tests/hdg-production-gate.test.mjs` |

## Lo que falta (en orden)

1. Hecho: **App en App Store Connect** "My HDG Mail", `com.hdgexecutivesuites.clientportal`,
   equipo **The Workbox, LLC (3KX6P6C79Q)**, el mismo que firma My Worx Mail.
2. Hecho: **`ascAppId` 6835613644** en `eas.json` → `submit.hdg-testflight-sandbox.ios`
   (con `appleTeamId: 3KX6P6C79Q`). Sin auto-submit (lo comprueba `tests/build-safety`).
3. **Credenciales iOS en EAS** (`hdg-client`: ninguna hoy). Del mismo equipo y vigentes
   (comprobado en EAS, solo lectura, 2026-11-17), autorizadas para reutilizar:
   - certificado **Apple Distribution** serie `735B657D10EC07FF2921CEFA55BE356E`,
     equipo 3KX6P6C79Q, valido hasta 2027-10-14;
   - clave **APNs `46PKSW3B6D`**, equipo 3KX6P6C79Q.
   El **perfil de aprovisionamiento** es nuevo y propio de `com.hdgexecutivesuites.clientportal`;
   el de The Worx (`com.theworxoffices.clientportal`) no se toca. Se crea en el primer
   `eas build` con inicio de sesion de Apple (2FA): pasos exactos abajo.
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

## Primera build (interactiva: Apple ID y 2FA)

```powershell
cd D:\app_paqueter_react_native\apps\mobile
git switch feat/mobile-hdg-testflight
npx eas-cli@27.10.0 build --platform ios --profile hdg-testflight-sandbox
```

Que contestar (el texto exacto puede variar un poco entre versiones de EAS CLI):

| Pregunta | Respuesta |
|---|---|
| (antes de nada) proyecto en la salida | debe ser `@ab-estrategia-360/hdg-client`; si sale `worx-client`, Ctrl+C |
| Do you want to log in to your Apple account? | **Yes** → Apple ID, contraseña, codigo 2FA |
| Select a team | **The Workbox, LLC (3KX6P6C79Q)**. Ningun otro |
| Reuse this distribution certificate? (serie `735B657D…356E`, de `worx-client`) | **Yes** |
| Generate a new Apple Provisioning Profile? | **Yes** (perfil nuevo del bundle de HDG) |
| Push Notifications: reuse this Push Key? (`46PKSW3B6D`) | **Yes** |
| Would you like to submit…? / auto-submit | **No** (la subida va aparte) |

Si pregunta otra cosa (revocar, otro equipo, otro bundle id), parar y no contestar.

## Subida a TestFlight (interna; nunca a revision de App Store)

```powershell
npx eas-cli@27.10.0 submit --platform ios --profile hdg-testflight-sandbox --id <id de la build>
```

Destino: `ascAppId 6835613644`. EAS pide credenciales de App Store Connect: o iniciar
sesion con Apple, o una **clave de la API de App Store Connect**. El proyecto de The Worx
tiene una (`9P86T93SD9`, rol App Manager, mismo equipo); reutilizarla o generar una
nueva para HDG es decision tuya (no esta autorizada en este documento). En App Store
Connect → TestFlight: grupo **interno** solamente.

Lanzarlo desde `D:\` (mayuscula) en Windows: con `d:\` Metro no resuelve `@paqueteria/core`.

## Riesgo a vigilar

Una build de TestFlight es una build de tienda: **no debe enviarse a revision de App
Store**. Apunta a HDG Sandbox (datos y pagos de prueba) y enseña la franja "Sandbox".
La version comercial de HDG saldra de `hdg-production`, que sigue bloqueado hasta tener su
API de produccion y la autorizacion del lanzamiento.
