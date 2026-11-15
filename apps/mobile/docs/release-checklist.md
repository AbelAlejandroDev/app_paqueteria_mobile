# Checklist final: builds de prueba iOS y Android (The Worx y HDG)

Estado a 2026-11-15, rama `feat/mobile-fase-7`. Revisado en solo lectura: no se ha
ejecutado `eas build`, `eas submit` ni `eas update`.

## 0. Antes de la primera build (decisiones)

- [ ] **Dependencias del SDK 57.** `npx expo install --check` pide 12 parches
      (`expo` 57.0.27 → ~57.0.33, `expo-router` → ~57.0.31, `expo-notifications` →
      ~57.0.25, `expo-updates` → ~57.0.28, …). Instalarlos cambia lo nativo: subir
      `RUNTIME_VERSION` (`native-3`) y regenerar `native-runtime.json`
      (`npm run native-runtime`). Consecuencia: las builds de tienda de The Worx que ya
      existen (`native-2`) no recibiran OTAs del codigo nuevo; necesitan binario nuevo.
- [ ] **Firebase de HDG** (si la build de Android de HDG debe tener push): añadir
      `google-services.json` tambien sube `RUNTIME_VERSION`. Hacerlo a la vez que lo
      anterior evita dos subidas.
- [ ] Rama de la build: fusionar `feat/mobile-fase-7` donde corresponda (no a `main`
      sin revision).
- [ ] Lanzar todo desde `apps/mobile` y, en Windows, desde `D:\` (mayuscula): con
      `d:\` Metro no resuelve `@paqueteria/core`.

## 1. Lo que ya esta (comprobado)

| Pieza | The Worx | HDG |
|---|---|---|
| Proyecto EAS | `@ab-estrategia-360/worx-client` (`922f4b80-…`) | `@ab-estrategia-360/hdg-client` (`2e12104c-…`) |
| iOS bundle id / Android package | `com.theworxoffices.clientportal` | `com.hdgexecutivesuites.clientportal` |
| API | `https://core.theworxoffices.com/api/v1` (production) | `https://core.hdgexecutivesuites.com/api/v1` (Sandbox) |
| Perfiles | development, preview (APK), simulator, production, production-apk | development, preview (APK), simulator, **testflight-sandbox**, production (**bloqueado**) |
| Canales OTA | development, preview, production → production | development, preview, testflight-sandbox → sandbox; production → bloqueado |
| Version / build | `1.0.0`; numeros de build remotos en EAS (`appVersionSource: remote`), `autoIncrement` en tienda | igual |
| Runtime | `native-2` | `native-2` |
| Submit | iOS `ascAppId 6822867406`; Android `internal`/`draft` | **sin destino** (falta `ascAppId`) |
| Identificacion de pruebas | — | franja "Sandbox" desde el arranque; canal propio |

`eas config` resuelve los 18 perfiles validos (iOS y Android) con su marca, canal y API;
`hdg-production` falla a proposito ("los builds de production estan bloqueados").

**OTA:** cada marca publica en su proyecto (una no llega a la otra) y, dentro de una
marca, `scripts/eas-update.js` arma el update con el entorno del canal o se niega; la
app ademas no arranca la API si el canal del binario no corresponde al entorno del
bundle (`brands/update-channels.js`). Publicar siempre con:

```bash
node scripts/eas-update.js <marca> <canal> --message "que cambia"        # plan
node scripts/eas-update.js <marca> <canal> --message "que cambia" --run  # publicar
```

## 2. Credenciales y servicios externos (manual)

### Apple (App Store Connect / Developer)

- [ ] **Decidir el equipo de Apple de HDG** (el de The Worx u otro). Rol Admin o App Manager.
- [ ] Crear la app **My HDG Mail** (`com.hdgexecutivesuites.clientportal`) en App Store
      Connect y anotar su **Apple ID numerico** (`ascAppId`).
- [ ] Añadirlo a `eas.json`:
      `"submit": { "hdg-testflight-sandbox": { "ios": { "ascAppId": "<id>" } } }`
      (y quitar `submit.hdg-testflight-sandbox === undefined` de `tests/build-safety.test.mjs`).
- [ ] **APNs de HDG**: en el primer `eas build -p ios` de HDG aceptar "Set up Push
      Notifications" (EAS crea la clave), o subir una clave `.p8` existente con
      `eas credentials`. La clave no va a Git.
- [ ] **The Worx**: `eas credentials` → iOS → comprobar certificado de distribucion,
      perfil App Store y clave APNs (hay 4 builds de tienda: deberian existir).
- [ ] Team ID (Membership) para los Universal Links (seccion 4).

### Google (Firebase / Play Console)

- [ ] **Firebase de HDG**: proyecto (o el existente) → app Android
      `com.hdgexecutivesuites.clientportal` → descargar `google-services.json` →
      `apps/mobile/assets/brands/hdg/google-services.json` (publico, si va a Git).
- [ ] **FCM v1 de HDG**: Firebase → Cuentas de servicio → clave JSON →
      `eas credentials` → Android → Push Notifications (FCM V1). **No va a Git.**
- [ ] **The Worx**: `eas credentials` → Android → comprobar clave FCM v1 y keystore.
- [ ] **Play Console**: app de HDG (para distribuir por Google Play) y, para
      `eas submit` Android, una cuenta de servicio de Google Play con permisos de
      publicacion (en EAS, no en el repo). The Worx: comprobar que ya existe.
- [ ] Huellas SHA-256 de firma (keystore de EAS y Play App Signing) para App Links.

## 3. TestFlight HDG Sandbox

1. [ ] Seccion 0 y Apple de la seccion 2.
2. [ ] `APP_BRAND=hdg APP_ENV=sandbox EXPO_PUBLIC_API_URL=https://core.hdgexecutivesuites.com/api/v1 npx eas-cli build --profile hdg-testflight-sandbox --platform ios`
       (interactivo la primera vez: iniciar sesion en Apple, credenciales y APNs).
3. [ ] `npx eas-cli submit --profile hdg-testflight-sandbox --platform ios` (con el `ascAppId`).
4. [ ] App Store Connect → TestFlight: informacion de prueba, grupo interno; si es
       externo, revision beta con una **cuenta de prueba de HDG Sandbox**.
5. [ ] **No enviar nunca esta build a revision de App Store**: apunta a Sandbox.

## 4. TestFlight The Worx

1. [ ] Seccion 0.
2. [ ] `npx eas-cli build --profile worx-production --platform ios` (incrementa el build en EAS).
3. [ ] `npx eas-cli submit --profile worx-production --platform ios` (`ascAppId 6822867406`).
4. [ ] TestFlight interno. Ojo: es la **API de produccion** de The Worx (Stripe en modo
       TEST segun el backend): usar cuentas de prueba, no clientes reales.

## 5. Android HDG

1. [ ] Firebase de HDG (seccion 2) si se quiere push; si no, la app avisa de que no
       hay notificaciones en Android.
2. [ ] Pruebas internas: `npx eas-cli build --profile hdg-preview --platform android` (APK,
       distribucion interna, Sandbox). Instalar desde el enlace de EAS.
3. [ ] Google Play (prueba interna): crear la app en Play Console; build de tienda de
       Sandbox con `hdg-testflight-sandbox --platform android` (AAB). Añadir un perfil
       de submit Android cuando exista la cuenta de servicio.

## 6. Android The Worx

1. [ ] `npx eas-cli build --profile worx-preview --platform android` (APK interno), o
       `worx-production` (AAB) + `eas submit --profile worx-production --platform android`
       (pista `internal`, borrador).

## 7. Universal Links / App Links (no bloquean las builds)

Siguen **apagados** (`brands/index.js`, `appLinks.enabled: false`). Para encenderlos:
`docs/deep-links.md` y el contrato del backend en `docs/backend-contract-gaps.md`
(fase 7, #1): el backend tiene que servir `/.well-known/…` en cada portal.

## 8. Pruebas de aceptacion en dispositivos reales

Con cuentas de prueba en The Worx y HDG Sandbox. Marcar por plataforma (iOS / Android).

**Sesion y entorno**
- [ ] Login de cada marca; una cuenta de la otra marca se rechaza ("isn't part of …").
- [ ] HDG enseña "Sandbox" antes y despues del login; The Worx no.
- [ ] Modo avion: pantalla "No internet connection", la sesion sigue; al volver, reconecta.
- [ ] Bloqueo biometrico y cierre de sesion.

**Correo y servicios**
- [ ] Lista, detalle, fotos y PDF de escaneo; tras logout y login con otra cuenta no
      queda ni el PDF ni la foto anterior.
- [ ] Pedir escaneo; aprobar un escaneo cotizado (con y sin cargo).
- [ ] Reenvio: cotizar, elegir tarifa, pagar (Stripe TEST en The Worx; Zoho Sandbox en
      HDG con el cobro activado), recotizacion, "Check payment status".
- [ ] Recogida, descarte, direcciones de reenvio.

**Facturacion**
- [ ] The Worx: portal de Stripe. HDG: tarjetas, facturas, pagar factura, actualizar o
      añadir tarjeta (paginas de Zoho Sandbox) y volver.
- [ ] Mora: aviso "Billing needs attention" y acciones deshabilitadas.

**Notificaciones** (ver `docs/push-setup.md`)
- [ ] Registro y recepcion con la app delante, en segundo plano y cerrada.
- [ ] Toque de cada tipo abre su pantalla; sin sesion no abre nada.
- [ ] Logout con red: no llegan mas avisos. **Logout en modo avion**: tampoco (el token se
      invalida en el dispositivo); al volver la red y entrar otra cuenta, solo los suyos.

**OTA**
- [ ] Un update del canal de la build llega; un update de otro canal o entorno no.

## 9. Confirmacion

En esta fase no se ha construido, enviado ni publicado nada (ni builds, ni OTAs), ni se
han tocado el VPS, DNS, Zoho, Stripe o los portales.
