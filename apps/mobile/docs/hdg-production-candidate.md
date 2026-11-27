# My HDG Mail 1.0.0: candidato de HDG Production

Estado a 2026-11-26. Rama `release/hdg-mobile-production`, sobre `7bfe9a9` (`hdg/forward-sheet-fixes`,
que incluye `main`). Nada construido ni enviado a las tiendas. Completa
`docs/hdg-production-app-review.md` (builds, demo) y `docs/hdg-store-submission.md` (fichas,
privacidad, riesgos); no los sustituye.

## 1. Configuracion comprobada

| | Valor | Como se comprobo |
|---|---|---|
| Bundle iOS / package Android | `com.hdgexecutivesuites.clientportal` | `eas config --profile hdg-production` (ios y android) |
| Perfil | `hdg-production` → `base-production`: tienda, canal `production`, entorno EAS `production`, `autoIncrement` | `eas config`, `tests/hdg-production-release.test.mjs` |
| API | `https://core.hdgexecutivesuites.com/api/v1` | `eas config`; export iOS y Android: solo `core`, sin `sandbox-core` ni The Worx |
| `core` es Production | `GET /public/portal` sin `deployment`, tenant `hdg` | `npm run check:hdg-production` → OK (2026-11-26) |
| Runtime | `native-3`, el mismo que la build de TestFlight Sandbox `b8e47a41`, probada en iPhone | `app.config.js`, `tests/native-runtime.test.mjs` |
| Actualizaciones | `https://u.expo.dev/2e12104c-…` (`hdg-client`); el canal `production` solo admite la API de Production (`updateChannels`) | `eas config` |
| Canales EAS existentes | `testflight-sandbox`, `preview`. `production` no existe todavia: lo crea la primera build | `eas channel:list` |
| Numeros de build (remotos) | Ultimos: iOS 1.0.0 (2) Sandbox, Android versionCode 1 (APK interna). Production sera iOS (3) y Android (2) | `eas build:list` |
| Variables EAS `production` | Ninguna (la API va en `eas.json`); ningun secreto en el bundle | `eas env:list production`, busqueda en el export |
| Firebase | `my-hdg-mail-f00be`, package de HDG | `scripts/check-google-services.js` |
| Target SDK Android | 36 (compile 36, min 24) | `react-native/gradle/libs.versions.toml` (SDK 57) |
| Permisos Android | Camara, biometria, notificaciones, almacenamiento heredado de los modulos de Expo (no `READ_MEDIA_*`); sin `SYSTEM_ALERT_WINDOW` ni `RECORD_AUDIO` | manifiestos de los modulos y `app.config.js` |
| Info.plist | Camara, fotos y Face ID con texto; cifrado exento; `aps-environment` pasa a `production` al exportar para la App Store (verificar en el IPA) | `expo config --type introspect` |

## 2. Cambios de este candidato

- **Settings → Automatic Forwarding Charges** solo aparece si el centro ofrece reenvios. HDG
  Production abre con `services.forwarding: false`, y la pantalla solo diria "Not available": en
  revision parece una funcion rota (Apple 2.1). Solo un `false` explicito la quita; si las
  capacidades fallan sigue visible, para poder retirar siempre una autorizacion.
- El aviso biometrico por defecto decia "Unlock The Worx". Ninguna pantalla lo usaba, pero ya no
  nombra marca; un test impide textos de The Worx en el codigo de la app.
- Tests: `tests/hdg-production-release.test.mjs`. Solo JS: OTA compatible con `native-3`.

## 3. Lo que Production tiene apagado hoy (`GET /public/portal`, 2026-11-26)

`onlinePayments`, `invoices`, `billingPortal`, `forwardingPayments`, `services.forwarding` y
`paidScans` en `false`; `cancellationRequest` en `true`; `legal.privacyPolicyUrl` en `null` (la
app usa la de la marca, 200). La app respeta cada interruptor: no ofrece reenvio, pago ni
Automatic Forwarding Charges, y Billing dice "Billing is managed by your center" si no hay
proveedor.

## 4. Decisiones

- **Dependencias sin actualizar.** `expo-doctor` marca 9 parches de SDK 57 (expo-notifications,
  expo-updates, expo-router, expo-image-picker, …). No se suben: son nativos, obligarian a
  `native-4` y la build de Production dejaria de ser el mismo binario nativo ya probado en
  TestFlight Sandbox, que ademas se quedaria sin OTAs. Subirlos despues del lanzamiento.
- **Backend `20b70a8` y web `b8a9050`** no estan en GitHub (solo en el VPS): este candidato no se
  ha cotejado con ellos. El contrato usado es `docs/hdg-cartas-cobro-automatico.md` (.3).

## 5. Comandos (requieren autorizacion)

Desde `D:\` en mayuscula y con `git status` limpio en este commit:

```powershell
cd D:\app_paqueter_react_native\apps\mobile
npm run check:hdg-production          # tiene que decir OK
$env:APP_BRAND="hdg"; $env:APP_ENV="production"; $env:EXPO_PUBLIC_API_URL="https://core.hdgexecutivesuites.com/api/v1"
npx eas-cli@27.10.0 build --platform ios --profile hdg-production --non-interactive --no-wait
npx eas-cli@27.10.0 build --platform android --profile hdg-production --non-interactive --no-wait
```

Subida, despues de verificar cada artefacto (`docs/hdg-production-app-review.md` §3):

```powershell
npx eas-cli@27.10.0 submit --platform ios --profile hdg-production --id <build iOS> --non-interactive
# Android, primera version: la AAB se sube a mano en Play Console (la API no acepta la primera).
```
