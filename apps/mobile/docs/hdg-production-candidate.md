# My HDG Mail 1.0.0: candidato de HDG Production

Estado a 2026-11-26. Rama `release/hdg-mobile-production`. Nada construido ni enviado a las tiendas.
Completa `docs/hdg-production-app-review.md` (builds, demo) y `docs/hdg-store-submission.md` (fichas,
privacidad, riesgos); no los sustituye.

## 1. Backend: con que se ha cotejado

`20b70a8` (backend) y `b8a9050` (web) **no estan en GitHub** ni en este equipo: no se han podido
leer. Se ha cotejado con el backend publico mas reciente, `9209392`
(`fix/hdg-staff-postage-balance-select`, 2026-11-25). Contiene `main`, `feat/hdg-production-supabase`
(privacidad configurable), `hdg/lanzamiento-revision` (borrado de cuenta), `feature/hdg-app-review-demo`
(modo demo) y `103ddd7` (cobro automatico, ya validado). `20b70a8` tiene que contenerlo; lo que haya
entre los dos no esta revisado.

| Flujo | Rutas (todas existen en `9209392`) | Resultado |
|---|---|---|
| Login | `POST /auth/login`, `GET /auth/me`, `/auth/terms/current(/accept)`, `forgot-password`, `set-password`, `logout` | Compatible |
| Capacidades | `GET /client/capabilities` (contrato 1) | Compatible; `demo` (nuevo) se lee, ver §3 |
| LETTER / LARGE_ENVELOPE | `POST /client/service-requests` (lo prepara el centro), `/forwarding-addresses/verify` | Compatible; `103ddd7` → `9209392` solo cambia el lado del personal (saldo de franqueo antes de guardar la tarifa) |
| PACKAGE | `quotes`, `quotes/select`, `prepare-payment`, `payment-status`, `confirm-repriced-rate` | Compatible |
| Consentimiento (Settings) | `GET/PUT /client/forwarding/auto-charge-consent` | Compatible (contrato `.3`) |
| Cobro del centro, pago manual, incierto, rechazo | `prepare-payment` (`autoCharge.reason`, 409 `COLLECT_*`), `payment-status` | Compatible (validado en `f1bd25e`) |
| Tarjeta | `POST /client/billing/zoho/update-card`, `add-payment-method`, `invoices/:id/pay` | Compatible |
| Borrado de cuenta | `GET/POST /client/account-deletion`, `/:id/withdraw`; web: `/public/account-deletion/*` | Compatible |
| Notificaciones | `/client/notifications…`, `/client/notification-preferences`, `/client/push-devices(/unregister)` | Compatible |

La app no llama a ninguna ruta que no exista. No usa `/auth/refresh` ni `demo-label`.

## 2. Privacidad y borrado de cuenta en Production

**Por que `privacyPolicyUrl: null`.** Dos causas, comprobadas con `GET /public/legal?tenant=hdg`:

1. **Production corre un backend anterior a `0497bab` (2026-11-22).** Su respuesta es
   `{"tenant":"hdg","privacyPolicyUrl":null}`, sin `accountDeletionUrl`, `termsUrl` ni
   `accountDeletion`, que `src/controllers/public/legal.js` siempre manda desde `0497bab`.
   Sandbox ya los manda.
2. **Faltan las variables.** `src/config/legalLinks.js` no tiene valor por defecto: sin
   `PRIVACY_POLICY_URL__HDG` y `ACCOUNT_DELETION_URL__HDG` el campo es `null`. Faltan en Production
   y en Sandbox.

**Lo que hay que hacer en el backend de Production** (no lo hace la app):

```
# entorno del backend de HDG Production
PRIVACY_POLICY_URL__HDG=https://www.hdgexecutivesuites.com/my-hdg-mail-privacy-policy/
ACCOUNT_DELETION_URL__HDG=https://members.hdgexecutivesuites.com/account-deletion
```

1. Desplegar `20b70a8` (o cualquiera que contenga `0497bab`).
2. Poner las dos variables (https limpias; `legalLinksProblem` avisa si una es invalida) y reiniciar.
3. Comprobar desde aqui: `npm run check:hdg-legal` tiene que decir `OK`. Sin eso, no construir.

**En la app.** Lee las dos URLs de `/public/legal` (antes del login) y de `capabilities.legal` (con
sesion). Si el backend da `null`, enseña la de la marca, para que nunca falte la politica. Ese respaldo
ya no tapa nada: `scripts/check-hdg-legal.js` falla y dice la causa (backend anterior o variable que
falta). Hoy responde:

```
FALLO: https://core.hdgexecutivesuites.com/api/v1/public/legal?tenant=hdg
  - privacyPolicyUrl es null: falta PRIVACY_POLICY_URL__HDG en el entorno del backend.
  - falta accountDeletionUrl: el backend desplegado es anterior al que lo devuelve (0497bab).
```

## 3. Cuenta de App Review (modo demo)

Contrato: backend `docs/mobile/app-review-demo.md` (`45569af`). El servidor decide quien es demo
(`APP_REVIEW_DEMO_ENABLED__HDG=true`, id en `APP_REVIEW_DEMO_USER_IDS__HDG`, buzon de `hollywood`,
beneficio `APP_REVIEW_DEMO`); la app no decide nada.

**En la app:**

| Punto del contrato | Estado |
|---|---|
| `paymentUrl` del host de la API | Se abre: la app acepta cualquier https y no tiene lista de hosts de Zoho |
| Seguimiento `DEMO…` | La app no enlaza con la web del transportista: nada que romper |
| Aviso | **Nuevo**: `capabilities.demo.notice` en el panel y en el pago del reenvio. Solo esa cuenta lo recibe |
| Etiqueta de muestra (`demoLabelPath`) | No se ofrece (opcional en el contrato) |

**Sin cargos ni compras.** Lo garantiza el servidor:
- Zoho, Stripe y Pitney lanzan `APP_REVIEW_DEMO_PROVIDER_BLOCKED` dentro del contexto demo;
- el pago es una pagina con "DEMO - SIMULATED PAYMENT - NO CHARGE", sin datos de tarjeta, o `paid` en
  el acto con tarjeta guardada;
- factura `DEMO-XXXXXXXX`, sin `ZohoCharge` ni `BillingItem`;
- etiqueta PDF "SAMPLE LABEL — NOT VALID FOR SHIPPING".

La app no puede cobrar nada por su cuenta: todo pago pasa por esas rutas.

**Bloqueo en `9209392` (backend).** En demo, `services` sale de `portalServices()` sin excepcion de
demo, y `withCenterServices()` pone `canRequestForward: false` en cada pieza mientras
`services.forwarding` sea `false`. HDG Production lo tiene en `false` (cobro de Zoho apagado). Con
ese backend **la cuenta demo no ve "Forward"** y el flujo simulado no se puede empezar. La app no lo
sortea: hace lo que dice el servidor. Hay que confirmar si `20b70a8` lo corrige (servicios conscientes
del modo demo). Si no:
- o se corrige en el backend;
- o la revision se hace sin reenvio y las notas lo explican (la descripcion de la tienda lo anuncia).

Las cartas (LETTER, LARGE_ENVELOPE) en demo van por el flujo que prepara el centro. No se marcan
demo, no entran en la cola del personal (`excludeAppReviewDemoRequests`) y no se cobran nunca: se
quedan pedidas. El reenvio de punta a punta en demo es el de PACKAGE (`DEMO03`).

**Acceso para Apple y Google** (sin crear la cuenta ni cambiar credenciales todavia):
- Usuario: `appreview@hdgexecutivesuites.com`. Contrasena: la del fichero
  `/srv/hdg-prod/secrets/app-review-demo.pw`, solo en App Store Connect (App Review Information) y en
  Play Console (App access). Nunca en Git ni en un chat.
- Crear: `APP_DEPLOYMENT=production node src/maintenance/seedAppReviewDemo.js --password-file … --apply
  --confirm SEMBRAR-DEMO-APP-REVIEW-HDG`; despues, su id en `APP_REVIEW_DEMO_USER_IDS__HDG` y
  `APP_REVIEW_DEMO_ENABLED__HDG=true`.
- Restablecer entre revisiones: `--reset --apply --confirm RESTABLECER-DEMO-APP-REVIEW-HDG`.

**Pruebas con la cuenta demo** (build de Production, iPhone y Android):

| # | Prueba | Esperado |
|---|---|---|
| D1 | Login | Entra; panel con el aviso azul "App Review demo account: payments and shipping labels are simulated." |
| D2 | Buzon | `DEMO01`–`DEMO05` con fotos; `DEMO02` abre el PDF |
| D3 | Escaneo de `DEMO01` | Se pide sin cargo (beneficio UMS) |
| D4 | Forward de `DEMO03` (paquete) | Con `9209392`: no aparece (bloqueo de arriba). Con el backend corregido: direccion verificada, tarifas "(demo)" |
| D5 | Pagar | Aviso demo en la tarjeta; la pagina dice "DEMO - SIMULATED PAYMENT - NO CHARGE" y no pide tarjeta |
| D6 | Despues del pago | `PAID`, `LABEL_PURCHASED`, seguimiento `DEMO…`; en Zoho no hay factura ni cobro |
| D7 | Settings | Sin "Automatic Forwarding Charges" mientras `services.forwarding` sea `false` |
| D8 | Privacy Policy (Login y Settings) | Abre `my-hdg-mail-privacy-policy`, la del backend tras §2 |
| D9 | Delete Account | Pantalla y enlace web; **no enviar** (o `--reset` despues) |
| D10 | Sign out | Vuelve a Login |
| D11 | Cliente normal | Sin aviso demo |

## 4. EAS: configuracion efectiva

`eas config --profile hdg-production` (ios y android), 2026-11-26:

| | Valor |
|---|---|
| Perfil | `extends base-production`: `distribution store`, canal `production`, entorno EAS `production`, `autoIncrement` |
| `env` | `APP_BRAND=hdg`, `APP_ENV=production`, `EXPO_PUBLIC_API_URL=https://core.hdgexecutivesuites.com/api/v1` |
| Bundle / package | `com.hdgexecutivesuites.clientportal` |
| Proyecto | `hdg-client` (`2e12104c-c190-48aa-b044-da110d34e8f1`); updates `https://u.expo.dev/2e12104c-…` |
| Runtime | `native-3` |
| Firebase | `./assets/brands/hdg/google-services.json` (`my-hdg-mail-f00be`) |
| APNs / FCM | En EAS (`hdg-client`): APNs `46PKSW3B6D`, FCM v1 `expo-push-hdg@my-hdg-mail-f00be` (`docs/push-setup.md`); no se pueden releer sin `eas credentials` interactivo |
| Variables EAS `production` | Ninguna (`eas env:list production`) |

**Como llegan las variables al builder remoto.**
- Las lleva el perfil (`eas.json` → `build.hdg-production.env`). `eas.json` va en el proyecto que se
  sube, y EAS las pone en el entorno del builder: el `app.config.js` remoto y Metro (que incrusta
  `EXPO_PUBLIC_API_URL` en el JS) las leen alli.
- **No** dependen de PowerShell: el `$env:` local solo sirve para que `eas-cli` resuelva el proyecto
  en local, y es obligatorio para `eas submit`, que no lee el `env` del perfil.
- Prueba: la build `b8e47a41` (`4cb5dc1`) llevo incrustada la URL que su perfil tenia entonces en
  `eas.json`.

**Como se comprueba en cada build.**
- `eas-build-pre-install` (`scripts/check-hdg-production.js`) corre en el builder antes de instalar.
  Con `EAS_BUILD_PROFILE=hdg-production` exige las tres variables exactas; si falta o cambia una,
  **para la build** (`FRENADO: el perfil hdg-production llego al builder sin sus variables …`). Si
  estan, deja en el log `OK: variables del builder: APP_BRAND=hdg APP_ENV=production
  EXPO_PUBLIC_API_URL=https://core.hdgexecutivesuites.com/api/v1.` y comprueba que `core` sea
  Production.
- `app.config.js` (`resolveApiConfig`) lanza si la marca, el entorno y la URL no casan.
- Si un dia se crean variables del entorno EAS `production` con esos nombres, el hook las detecta igual:
  mira el valor final que ve el builder.

## 5. Cambios de este candidato

- `975b2ad`: Settings sin "Automatic Forwarding Charges" con el reenvio apagado; aviso biometrico sin
  marca.
- Este commit:
  - aviso de la cuenta demo (`capabilities.demo`) en el panel y en el pago;
  - `scripts/check-hdg-legal.js` (`npm run check:hdg-legal`);
  - comprobacion de variables en el builder (`check-hdg-production.js`);
  - `tests/hdg-production-release.test.mjs` ampliado.
- Todo es JS y scripts: compatible con `native-3`, sin dependencias nuevas.
- No se actualizan los 9 parches nativos que marca `expo-doctor`: obligarian a `native-4`.

## 6. Comandos (requieren autorizacion)

Antes, en este orden:
- backend de Production desplegado y con las variables de §2;
- `npm run check:hdg-legal` → `OK`;
- `npm run check:hdg-production` → `OK`;
- `git status` limpio en el commit del candidato.

Desde `D:\` en mayuscula:

```powershell
cd D:\app_paqueter_react_native\apps\mobile
npm run check:hdg-legal
npm run check:hdg-production
$env:APP_BRAND="hdg"; $env:APP_ENV="production"; $env:EXPO_PUBLIC_API_URL="https://core.hdgexecutivesuites.com/api/v1"
npx eas-cli@27.10.0 build --platform ios --profile hdg-production --non-interactive --no-wait
npx eas-cli@27.10.0 build --platform android --profile hdg-production --non-interactive --no-wait
```

En el log de cada build buscar `OK: variables del builder: … core.hdgexecutivesuites.com …`. Salen
iOS 1.0.0 (3) y Android versionCode 2.

Subida, despues de verificar cada artefacto (`docs/hdg-production-app-review.md` §3):

```powershell
npx eas-cli@27.10.0 submit --platform ios --profile hdg-production --id <build iOS> --non-interactive
# Android, primera version: la AAB se sube a mano en Play Console (la API no acepta la primera).
```

## 7. Pruebas fisicas pendientes (nada probado aun en Production)

En un iPhone (TestFlight, build (3)) y un Android (pista interna, versionCode 2):

1. Settings → App Update: canal `production`, runtime `native-3`; la app habla con `core`.
2. Cuenta demo: D1–D11 de §3.
3. Push: permiso, token registrado (`/client/push-devices`) y un aviso recibido. En demo no se envian:
   hace falta una cuenta de prueba de Production autorizada para push, o dejarlo para despues.
4. Face ID / huella: activar en Security y abrir la app ("Unlock your mailbox").
5. USPS 1583: camara y fotos piden permiso con su texto.
6. IPA: `aps-environment production`, sin `sandbox-core`. AAB: `targetSdk 36`, sin
   `SYSTEM_ALERT_WINDOW` ni `RECORD_AUDIO`.
7. Sign out y volver a entrar; con "Keep me signed in" apagado, pide login al reabrir.
