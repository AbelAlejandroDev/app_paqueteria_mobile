# Notificaciones push: estado y configuracion

Estado a 2026-11-17 (rama `feat/mobile-hdg-push-ios`). Credenciales comprobadas en
EAS en modo lectura (metadatos, nunca claves).

## Registro del dispositivo (contrato con `projectId`)

Backend: rama `feat/push-receipts-hardening` (`b9bca42`), aun **sin desplegar** en HDG
Sandbox (que corre `backend-348c327`). La app vale para los dos:

| | Backend nuevo | Backend anterior (`348c327`) |
|---|---|---|
| Cuerpo | `{ token, platform, projectId }` | igual; responde `400 Invalid body` "Unrecognized key(s) in object: 'projectId'" |
| La app | 1 POST | ese 400 exacto → **un** POST mas sin `projectId` (`registered-legacy`). Cualquier otro 400 no se repite |
| `422 PUSH_PROJECT_MISMATCH` | no se reintenta; bloqueado hasta cerrar sesion o reiniciar la app | no existe |

- `projectId`: `Constants.expoConfig.extra.eas.projectId` (app.config.js, tambien en el
  manifiesto de cada OTA) y `Constants.easConfig.projectId` (EAS Build). Todas las que haya
  tienen que ser **el de la marca del bundle** (`brands/index.js`); si no, la app no pide
  token ni registra nada (`lib/push-registration.js`, `resolvePushProjectId`). Nunca se
  manda el de otra marca.
- **Cuando se registra** (`context/AuthContext.jsx` + `createPushRegistrationGate`): al haber
  sesion (login o arranque con sesion guardada: renueva `lastSeenAt` y reactiva un
  dispositivo desactivado), cuando Expo da un token nuevo (`addPushTokenListener`, forzado)
  y, si la app sigue abierta, a las 24 h. Una peticion a la vez y sin repetir lo hecho en la
  misma ejecucion.
- **Sesion revocada o de otra organizacion** (sin pasar por logout): ya no hay sesion para
  `unregister`, asi que el token se invalida en el dispositivo (`invalidatePushOnSessionLoss`;
  sin red queda pendiente y se reintenta al arrancar sin sesion). Sin red o 5xx no quitan la
  sesion, asi que nunca se invalida un token por un fallo temporal.
- **Logs**: solo el resultado (`registered`, `registered-legacy`, motivo). Nunca el token;
  `maskPushToken` si algun dia hiciera falta mostrar uno.

## Como funciona

- La app pide un **token de Expo** (`getExpoPushTokenAsync({ projectId })`) con el
  proyecto EAS **de su marca** y lo registra en `POST /client/push-devices`. El backend
  envia por `https://exp.host/--/api/v2/push/send`; Expo lo reenvia a **FCM**
  (Android) o **APNs** (iOS) con las credenciales guardadas en ese proyecto EAS.
- Cada marca es una app distinta con su proyecto: `@ab-estrategia-360/worx-client` y
  `@ab-estrategia-360/hdg-client` (`2e12104c-c190-48aa-b044-da110d34e8f1`). Un aviso de
  una marca no puede llegar a la otra.
- Al cerrar sesion: `push-devices/unregister` (mientras el token vale), se vacia la
  bandeja del sistema y el contador. Sin sesion, un aviso que llegue con la app
  delante no se enseña (`src/lib/push-presentation.js`).
- **Logout sin red** (fase 7): si `unregister` falla, el token se invalida en el propio
  dispositivo (`unregisterForNotificationsAsync`); si tampoco se puede, se reintenta al
  arrancar sin sesion. El siguiente login obtiene un token nuevo. Solo afecta a este
  telefono. Hay que **probarlo en dispositivo** (modo avion → logout → enviar un aviso a
  esa cuenta → no debe llegar).

## Dos ficheros, solo uno en Git

| Fichero | Que es | Donde vive |
|---|---|---|
| `assets/brands/<marca>/google-services.json` | Identificadores publicos de la app en Firebase. Va **dentro del APK** | En Git. `node scripts/check-google-services.js` comprueba paquete, proyecto (`firebaseProjectId` de `brands/index.js`) y que no sea una clave privada |
| Clave de cuenta de servicio (FCM v1) | Clave **privada** con la que Expo entrega en FCM | Solo en EAS (`eas credentials`). `.gitignore` bloquea `*service-account*.json`, `*firebase-adminsdk*.json`, `the-worx-client-*.json`, `my-hdg-mail-*.json`; un test falla si algun JSON versionado tiene `private_key` |

## The Worx

| Pieza | Estado |
|---|---|
| Firebase | Proyecto `the-worx-client` (fuera de la organizacion de Workspace, que prohibe crear claves: commit `a39cd80`) |
| `assets/brands/the_worx/google-services.json` | En el repo, `com.theworxoffices.clientportal` |
| FCM v1 en EAS (`worx-client`) | **Configurada**: `firebase-adminsdk-fbsvc@the-worx-client.iam.gserviceaccount.com`, subida el 2026-09-08 |
| Keystore Android en EAS | Existe (una credencial de build por defecto) |
| iOS: clave APNs | **Existe** en EAS (`worx-client`): key id `46PKSW3B6D`, junto al certificado de distribucion y el perfil App Store (vigentes hasta 2027-10-14). EAS no dice de que equipo de Apple es (`appleTeam: null`) |

## HDG

| Pieza | Estado |
|---|---|
| Firebase | Proyecto **`my-hdg-mail-f00be`** (el antiguo `my-hdg-mail` ya no se usa; el validador lo rechaza) |
| `assets/brands/hdg/google-services.json` | En el repo, `com.hdgexecutivesuites.clientportal` |
| FCM v1 en EAS (`hdg-client`) | **Configurada**: `expo-push-hdg@my-hdg-mail-f00be.iam.gserviceaccount.com`, subida el 2026-11-17 (UTC) |
| Seguridad push reforzada de Expo (`pushSecurityEnabled`) | **Desactivada** en los dos proyectos: el backend puede enviar sin access token |
| Keystore Android en EAS | **Generado** por EAS en la primera build (`hdg-preview`, 2026-11-17 UTC): "Build Credentials cBk4DE_2HW", JKS. Contraseñas y fichero solo en EAS; guardar una copia con `eas credentials` → Android → Keystore → Download, **fuera del repo** |
| Huellas del certificado (publicas) | SHA-1 `00:23:74:2B:74:61:10:69:B3:B3:BF:7B:3B:16:18:63:CE:3F:30:A5`<br>SHA-256 `45:5C:6C:C9:38:65:AD:68:9F:01:BE:03:FE:B6:3B:6F:1E:8E:2D:3A:48:9C:CC:2A:BC:D9:32:49:38:6E:8A:25`<br>Son de la firma de EAS (APK internas). Una build de Google Play se firma con la clave de Play y tendra otra huella (App Links: `docs/deep-links.md`) |
| iOS: clave APNs | **Falta**: `hdg-client` no tiene ninguna credencial iOS (`iosAppCredentials: []`) ni builds iOS. Procedimiento abajo (APNs de HDG) |
| Runtime | Sin cambios (`native-3`): el fichero no añade modulos nativos. Hace falta **binario nuevo**: las builds anteriores no llevaban Firebase |

## APNs de HDG (iOS)

Lo que ya esta en la app (no hay que tocar nada para APNs):

- `expo-notifications` en `app.config.js`: el plugin añade el entitlement
  `aps-environment` (por defecto `development`, sin `mode`) y EAS activa la capacidad
  **Push Notifications** en el App ID al crear el perfil. En una build de tienda
  (`hdg-testflight-sandbox`, `distribution: store`), el valor de `aps-environment` deberia
  salir del perfil App Store al exportar (production). **Comprobarlo en la primera build**:
  que llegue un push a TestFlight, o mirar los entitlements del `.ipa`.
- Sin `UIBackgroundModes: remote-notification`: no se usan avisos silenciosos, solo
  avisos con titulo, que iOS enseña con la app cerrada sin ese modo.
- Permiso: se pide una sola vez tras el login (`requestPermissionsAsync`); tras un "no" no
  se vuelve a preguntar (iOS solo deja una vez) y la app lo explica en Ajustes.

**¿Reutilizar la clave de The Worx?** Una clave APNs (`.p8`) es **del equipo** de Apple
Developer y vale para todas sus apps; Apple permite como mucho 2 por equipo.
- Si My HDG Mail va en **el mismo equipo** que My Worx Mail: tecnicamente se puede usar
  `46PKSW3B6D` (EAS la ofrece si la cuenta de Expo ya la tiene), pero es una credencial de
  The Worx: **solo con autorizacion expresa**. La alternativa es una clave nueva solo para
  HDG en ese equipo (si quedan huecos).
- Si va en **otro equipo** (el de HDG): clave nueva obligatoria; la de The Worx no le sirve.
- **Decision pendiente: que equipo de Apple se usa.** No se ha supuesto ninguno.

**Procedimiento interactivo (cuando se decida el equipo; no ejecutado).** Se puede hacer
**antes** de la primera build:

```powershell
cd D:\app_paqueter_react_native\apps\mobile
$env:APP_BRAND="hdg"; $env:APP_ENV="sandbox"; $env:EXPO_PUBLIC_API_URL="https://core.hdgexecutivesuites.com/api/v1"
npx eas-cli credentials -p ios
```

1. Comprobar en la cabecera: proyecto `@ab-estrategia-360/hdg-client` y bundle
   `com.hdgexecutivesuites.clientportal`. Si sale `worx-client`: Ctrl+C.
2. Perfil: **`hdg-testflight-sandbox`** (nunca `hdg-production`).
3. "Do you want to log in to your Apple account?" → **Yes** → Apple ID y codigo de 2FA →
   elegir **el equipo decidido**.
4. Menu → **Push Notifications: Manage your Apple Push Notifications Key**.
5. **Set up your project to use Push Notifications** →
   - equipo nuevo o sin autorizacion para la de The Worx: **Generate a new Apple Push
     Notifications service key**;
   - mismo equipo y con autorizacion: **Use an existing Push Key** → `46PKSW3B6D`.
6. Salir con **Go back** / **Exit**. Comprobar (solo lectura) que `hdg-client` tiene la
   clave y que `worx-client` sigue con la suya.

El certificado de distribucion y el perfil App Store se crean en el primer
`eas build -p ios --profile hdg-testflight-sandbox` (tambien interactivo: Apple ID). Si el
equipo es el de The Worx, EAS ofrece reutilizar su certificado de distribucion (un
certificado vale para todas las apps del equipo; el perfil es nuevo, del bundle de HDG).

Sin clave APNs, una build de TestFlight pide permiso, obtiene su token de Expo y lo
registra, pero los envios acaban en `InvalidCredentials` (en el backend nuevo:
`PushDelivery` `FAILED`, sin desactivar el dispositivo).

## HDG Sandbox y HDG Production con el mismo Firebase

Hoy **las dos comparten** proyecto EAS (`hdg-client`), application id
(`com.hdgexecutivesuites.clientportal`), proyecto Firebase y clave FCM v1. Es seguro
compartirlos:

- **El entorno lo decide la API, no el token.** Cada build lleva una sola API (eas.json +
  `brands/api-environment.js`) y el canal OTA no puede cambiarla (guarda de runtime en
  `brands/update-channels.js`). Una build de Sandbox solo registra su token en el backend
  de Sandbox, y uno de Production solo en el de Production.
- **No pueden convivir en un telefono**: mismo application id. La de Google Play se firma
  con la clave de Play, distinta del keystore de EAS, asi que para pasar de la APK de
  Sandbox a la de Play hay que desinstalar. Al desinstalar, FCM invalida el token y el
  backend de Sandbox deja de entregar a ese telefono (`DeviceNotRegistered`).
- **Usuarios y tenants**: el dispositivo se asocia al usuario de la sesion
  (`req.user.id`, nunca del cuerpo) y el usuario es de un tenant (`@@unique([tenantId, email])`).
  El token es unico en la tabla: si el telefono cambia de cuenta, se reasigna.

Un riesgo residual: si el backend de Sandbox y el de Production compartieran **la misma
base de datos**, un token quedaria a nombre de la ultima cuenta que lo registro, pero
seguiria siendo del mismo telefono y la misma app. No hay cruce entre marcas: el
proyecto EAS es distinto.

**Separar mas adelante** (no hace falta ahora; cambiar el application id requiere
autorizacion): solo si se quiere tener Sandbox y Production **instaladas a la vez** en un
mismo telefono. Seria otro application id (p. ej. `com.hdgexecutivesuites.clientportal.sandbox`)
registrado como segunda app Android **en el mismo proyecto Firebase**; la clave FCM v1 del
proyecto vale para las dos, pero en EAS hay que asociarla tambien a ese id.

## Backend (solo lectura, `app_paqueteria` main `1610ded`)

Lo que ya hay:

- `POST /client/push-devices` `{ token, platform }` → `201`; `POST /client/push-devices/unregister`
  `{ token }` → `204`, acotado al usuario de la sesion. En HDG Sandbox las dos rutas
  existen (sin sesion responden `401`).
- Solo acepta tokens de Expo (`422 INVALID_PUSH_TOKEN` si no).
- Envio en `src/lib/push.js` (`sendPushToUser`), sin access token; solo los tipos de
  `PUSHABLE_TYPES`. Nunca hace fallar la operacion que lo origina.
- Prueba sin efectos: `node src/maintenance/sendTestPush.js` lista dispositivos (tokens
  enmascarados); `--to <correo> --apply` manda un aviso de prueba sin crear nada ni cobrar;
  `--type MAIL_ITEM_RECEIVED` prueba la navegacion.

Lo que faltaba lo cubre la rama `feat/push-receipts-hardening` (`b9bca42`, **sin desplegar**;
`docs/operacion/push-expo.md` del backend): receipts de Expo, `PushDelivery` con reintentos y
sin duplicados, `DeviceNotRegistered` desactiva (no borra), `EXPO_ACCESS_TOKEN` opcional,
`EXPO_PROJECT_ID__<TENANT>`, logs sin tokens y `sendTestPush --tenant hdg --to <correo>
--device <huella>`. HDG Sandbox (`backend-348c327`) aun no lo tiene, y su guardia de salida
**bloquea `exp.host`**: hoy no sale ningun push del Sandbox.

## Probar en un Android real (HDG Sandbox)

1. Instalar la APK de `hdg-preview` (permitir instalar apps de origen desconocido).
2. Iniciar sesion con una **cuenta de prueba** de HDG Sandbox.
3. Aceptar el permiso de notificaciones (Android 13+ lo pide).
4. En el VPS de HDG Sandbox (backend nuevo desplegado y `exp.host` permitido):
   `APP_DEPLOYMENT=sandbox node src/maintenance/sendTestPush.js --tenant hdg` → debe aparecer **un** dispositivo:
   el correo de prueba, `android`, su huella y el proyecto `2e12104c-…`.
5. `APP_DEPLOYMENT=sandbox node src/maintenance/sendTestPush.js --tenant hdg --to <correo-de-prueba> --device <huella> --apply`
   (solo con autorizacion expresa), con la app:
   a) delante (sale el aviso dentro de la app), b) en segundo plano, c) cerrada (quitada
   de recientes). En b) y c) aparece en la bandeja.
6. `--type MAIL_ITEM_RECEIVED --apply` → tocarlo abre el correo.
   A los 15 min, `syncPushDelivery` debe dejar la entrega en `DELIVERED` (receipt).
7. Cerrar sesion → repetir el paso 4: el dispositivo ya no esta. Un envio no llega.
8. Entrar con **otra** cuenta de prueba en el mismo telefono → el paso 4 la muestra a ella;
   un envio a la primera no llega.

Nada de esto crea piezas, solicitudes ni cobros. No usar tokens de clientes reales.

## Que se ha probado sin dispositivo

`tests/push-navigation.test.mjs`, con simulaciones:

- Primer plano: con sesion se enseña el aviso; sin sesion, nada.
- Toque con la app abierta, en segundo plano (esperando al desbloqueo biometrico) y
  con la app cerrada (leido al arrancar, esperando a la sesion, sin abrirse dos veces).
- Sin sesion no se navega; si entra otra cuenta, el toque pendiente se descarta.
- Cada tipo con push del backend (`PUSHABLE_TYPES`) lleva a una pantalla que existe;
  ids raros no componen rutas; correo, escaneos, forwarding, cobros fallidos y
  facturacion van a su sitio; el cobro fallido de un escaneo decide por el proveedor.
