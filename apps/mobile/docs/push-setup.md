# Notificaciones push: estado y configuracion

Estado a 2026-11-16 (rama `feat/mobile-hdg-push-android`). Credenciales comprobadas en
EAS en modo lectura (metadatos, nunca claves).

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
| iOS: clave APNs | **Comprobar** con `eas credentials` → iOS → Push Notifications |

## HDG

| Pieza | Estado |
|---|---|
| Firebase | Proyecto **`my-hdg-mail-f00be`** (el antiguo `my-hdg-mail` ya no se usa; el validador lo rechaza) |
| `assets/brands/hdg/google-services.json` | En el repo, `com.hdgexecutivesuites.clientportal` |
| FCM v1 en EAS (`hdg-client`) | **Configurada**: `expo-push-hdg@my-hdg-mail-f00be.iam.gserviceaccount.com`, subida el 2026-11-17 (UTC) |
| Seguridad push reforzada de Expo (`pushSecurityEnabled`) | **Desactivada** en los dos proyectos: el backend puede enviar sin access token |
| Keystore Android en EAS | Lo genera EAS en la **primera build** (`hdg-preview`). Despues: `eas credentials` → Android → descargar y guardar una copia **fuera del repo** |
| iOS: clave APNs | **Falta** (no hay ninguna build iOS de HDG) |
| Runtime | Sin cambios (`native-3`): el fichero no añade modulos nativos. Hace falta **binario nuevo**: las builds anteriores no llevaban Firebase |

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

Lo que falta o conviene (para el equipo del VPS; la app no lo necesita para funcionar):

1. **Receipts.** Solo lee los *tickets*. Los errores de entrega de FCM
   (`InvalidCredentials`, `MismatchSenderId`) y casi todos los `DeviceNotRegistered`
   llegan en los *receipts* (`POST https://exp.host/--/api/v2/push/getReceipts` con los
   ids de los tickets, unos minutos despues). Sin eso, un fallo de credenciales de HDG no
   se ve en ningun log y los tokens muertos no se borran.
2. **Log de tickets con error.** Hoy solo se avisa si falla la peticion HTTP; un ticket
   `status: "error"` distinto de `DeviceNotRegistered` se pierde en silencio.
3. **Access token opcional.** Si algun dia se activa la seguridad push reforzada en
   `hdg-client` o `worx-client`, los envios se rechazan. Conviene aceptar
   `EXPO_ACCESS_TOKEN` (cabecera `Authorization: Bearer`) por despliegue, sin activarlo.
4. **`sendTestPush --to`** busca por correo sin tenant (`findFirst`). Si una base de datos
   tiene varios tenants con el mismo correo, podria elegir otro. Para la prueba de HDG,
   usar un correo de prueba que solo exista en HDG, o añadir `--tenant`.
5. **Confirmar el despliegue de HDG Sandbox**: que la version desplegada incluye
   `src/lib/push.js` y `src/maintenance/sendTestPush.js` y que tiene salida a `exp.host`.

## Probar en un Android real (HDG Sandbox)

1. Instalar la APK de `hdg-preview` (permitir instalar apps de origen desconocido).
2. Iniciar sesion con una **cuenta de prueba** de HDG Sandbox.
3. Aceptar el permiso de notificaciones (Android 13+ lo pide).
4. En el VPS de HDG Sandbox: `node src/maintenance/sendTestPush.js` → debe aparecer el
   correo, `android` y el token enmascarado.
5. `node src/maintenance/sendTestPush.js --to <correo-de-prueba> --apply`, con la app:
   a) delante (sale el aviso dentro de la app), b) en segundo plano, c) cerrada (quitada
   de recientes). En b) y c) aparece en la bandeja.
6. `--type MAIL_ITEM_RECEIVED --apply` → tocarlo abre el correo.
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
