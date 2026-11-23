# My HDG Mail 1.0.0: HDG Production, TestFlight y Apple App Review

Estado a 2026-11-21. Referencia del backend: `AbelAlejandroDev/app_paqueteria`, rama
`feat/hdg-production-supabase`, `3078f4e` (`docs/HDG_MOBILE_PRODUCTION_HANDOFF.md`). Solo
lectura: nada del backend se copia aqui.

## 1. Dominios

| Entorno | API | Perfiles de la app |
|---|---|---|
| HDG Production | `https://core.hdgexecutivesuites.com/api/v1` | `hdg-production` (TestFlight y App Store) |
| HDG Sandbox | `https://sandbox-core.hdgexecutivesuites.com/api/v1` | `hdg-development`, `hdg-preview`, `hdg-simulator`, `hdg-testflight-sandbox`, `npm run start:hdg` |

Son APIs y bases distintas: un token o usuario de una no existe en la otra.

**`core` ya es HDG Production** (fase 1, lanzamiento comercial apagado). Comprobado el
2026-11-21: `GET /public/portal` con `Origin: https://members.hdgexecutivesuites.com` ya no trae
`deployment` en `core`; `sandbox-core` sigue devolviendo `deployment: "sandbox"`.
`npm run check:hdg-production` responde `OK`.

## 2. Freno de la build de Production

`scripts/check-hdg-production.js` corre en EAS antes de instalar nada (hook
`eas-build-pre-install`), y solo actua con `APP_BRAND=hdg APP_ENV=production`.

- Hace un unico `GET /public/portal` con el `Origin` del portal de miembros.
- **Para la build** si la respuesta trae `deployment`, no es de HDG, o no se puede comprobar (red, 5xx).
- No inicia sesion ni escribe nada.
- Las builds de The Worx y de HDG Sandbox no pasan por el.

Antes de lanzar la build se puede comprobar a mano:

```powershell
cd D:\app_paqueter_react_native\apps\mobile
npm run check:hdg-production
```

Respuestas:
- `OK: ... es HDG Production`: se puede construir.
- `FRENADO: ... sigue siendo HDG sandbox`: todavia no se ha promovido.

## 3. Build y subida (cuando Production y la cuenta de demostracion esten listas)

Las credenciales iOS ya estan en EAS (`hdg-client`), sin 2FA:
- certificado Apple Distribution `735B657D…356E`;
- perfil App Store propio de `com.hdgexecutivesuites.clientportal`, ambos hasta 2027-10-14;
- clave APNs `46PKSW3B6D`;
- clave de App Store Connect `9P86T93SD9` para las subidas.

```powershell
cd D:\app_paqueter_react_native\apps\mobile
npm run check:hdg-production
npx eas-cli@27.10.0 build --platform ios --profile hdg-production --non-interactive --no-wait
# cuando termine, verificar el IPA (bundle, API core, aps-environment production) y:
$env:APP_BRAND="hdg"; $env:APP_ENV="production"; $env:EXPO_PUBLIC_API_URL="https://core.hdgexecutivesuites.com/api/v1"
npx eas-cli@27.10.0 submit --platform ios --profile hdg-production --id <id de la build> --non-interactive
```

- Lanzar desde `D:\` (mayuscula).
- `eas submit` no lee el `env` del perfil de build: sin `APP_BRAND=hdg` resuelve el proyecto de
  The Worx y EAS lo rechaza.
- `hdg-production` no tiene auto-submit.

### Android (Google Play)

`submit.hdg-production.android` sube a la pista **interna** y en **borrador**: no llega a nadie
hasta que se publica a mano en Play Console.

Antes de la primera subida:
1. Crear la app `com.hdgexecutivesuites.clientportal` en Play Console (cuenta de quien publica).
2. **Subir la primera AAB a mano** en Play Console: la API de Google Play no acepta la primera
   version de una app nueva.
3. Cuenta de servicio de Google Cloud con permiso de "Release" sobre esa app, y su clave JSON
   **subida a EAS** (`eas credentials`, proyecto `hdg-client`, Android → Google Service Account →
   "for submissions"). Nunca en el repo.

```powershell
cd D:\app_paqueter_react_native\apps\mobile
npm run check:hdg-production
npx eas-cli@27.10.0 build --platform android --profile hdg-production --non-interactive --no-wait
# primera vez: descargar la .aab y subirla a mano a la pista interna; despues:
$env:APP_BRAND="hdg"; $env:APP_ENV="production"; $env:EXPO_PUBLIC_API_URL="https://core.hdgexecutivesuites.com/api/v1"
npx eas-cli@27.10.0 submit --platform android --profile hdg-production --id <id de la build> --non-interactive
```

La keystore de subida ya esta en EAS (`hdg-client`, SHA-256 `45:5C:6C:C9:…`); al crear la app,
dejar que Google gestione la clave de firma (Play App Signing).

**No confundir builds.** TestFlight Sandbox y Production comparten la ficha de App Store Connect y
la version 1.0.0. Al enviar a revision, elegir solo el numero de build de `hdg-production`. Nunca
una de `hdg-testflight-sandbox`; la 1.0.0 (2) es Sandbox.

## 4. La build de TestFlight Sandbox ya instalada (1.0.0 (2))

Su JS incrustado lleva la API `core.hdgexecutivesuites.com` como si fuera Sandbox. Corregido con
la OTA `01a1ff06` (canal `testflight-sandbox`, `sandbox-core`), publicada el 2026-11-21. Un iPhone que no haya abierto la app desde entonces sigue con el JS incrustado y
**hoy hablaria con Production**: abrirla dos veces (la OTA se aplica en el segundo arranque) y
comprobar en Settings → App Update que dice `01a1ff06 · testflight-sandbox`.

**Cada build lleva solo su entorno.** Desde `feat/mobile-hdg-production`, la app no carga el
catalogo de marcas (`brands/`):
- `app.config.js` deja en `extra` solo la API, los canales, el proyecto EAS y la politica de
  privacidad de esa marca y ese entorno;
- `src/lib/runtime-api.js` exige que la URL sea exactamente la empaquetada en el JS
  (`EXPO_PUBLIC_API_URL`).

Resultado: el bundle de HDG Sandbox solo contiene `sandbox-core` (ni `core` ni The Worx), y el de
HDG Production solo `core`.

Al exportar a mano entre marcas o entornos, usar `npx expo export --clear`. Metro puede reutilizar
el valor de `EXPO_PUBLIC_API_URL` de la exportacion anterior; la app entonces no arranca la API.
`eas update` ya exporta con `--clear`, y EAS Build empieza sin cache.

### La APK interna de HDG Sandbox (Android, `hdg-preview`, build `307ee578`)

Tiene el mismo problema y **sigue sin corregir**:
- canal `preview`, API `core.hdgexecutivesuites.com` como Sandbox;
- `core` ya es Production: hoy esa APK habla con Production. Las cuentas de Sandbox no existen
  alli (bases distintas), asi que el login falla, pero no debe usarse.

Se corrige igual: un OTA **Android** al canal `preview` de `hdg-client` desde esta rama.
Requiere autorizacion y comprobar la compatibilidad contra esa build. Hasta entonces, no abrir
esa APK ni repartirla.

## 4b. Politica de privacidad y borrado por la web (backend 3a17a0e)

Donde aparece:
- antes de iniciar sesion, en Login, desde `GET /public/legal?tenant=hdg`;
- con sesion, en Settings → Legal, desde `GET /client/capabilities` → `legal`.

Si el backend da una URL https valida, se usa esa. Si dice `null`, o no responde, se usa la
publicada por HDG y empaquetada en la build:

| Enlace | URL de la marca (comprobada el 2026-11-23, 200) |
|---|---|
| Politica de privacidad de la app | `https://www.hdgexecutivesuites.com/my-hdg-mail-privacy-policy/` |
| Borrado de cuenta por la web | `https://members.hdgexecutivesuites.com/account-deletion` (en Settings → Delete Account) |

El 2026-11-23 `core` y `sandbox-core` todavia devuelven `privacyPolicyUrl: null`. La app
enseña igualmente la de la marca. Para que el backend sea la fuente, configurar en
Production:
- `PRIVACY_POLICY_URL__HDG=https://www.hdgexecutivesuites.com/my-hdg-mail-privacy-policy/`
- `ACCOUNT_DELETION_URL__HDG=https://members.hdgexecutivesuites.com/account-deletion`

## 5. Cuenta de demostracion para Apple (la crea el backend, no la app)

| | |
|---|---|
| Usuario | `appreview@hdgexecutivesuites.com` |
| Contrasena | La entrega el propietario directamente en App Store Connect. Nunca en Git. |
| Contenido | Buzon `A-9001` (PREMIUM, UMS de demostracion sin cargo); piezas `DEMO01`–`DEMO05` con fotos y el PDF de DEMO02; un escaneo pendiente; un aviso sin leer |

Se crea despues de promover (`seedAppReviewDemo.js`, procedimiento
`deploy/hdg-production/APP-REVIEW.md` del backend). Restablecerla cierra sus sesiones: la app
vuelve al login con el 401 del refresh.

## 6. Durante la revision (fase 1 del backend)

| Funciona | No funciona, y lo que ve el revisor |
|---|---|
| Login, terminos, buzon, piezas, fotos y PDF, avisos dentro de la app, perfil, contrasena, direcciones, baja de cuenta, pedir escaneo (UMS, sin cargo) | **Push:** el registro funciona, pero no se envian.<br>**Correo y SMS:** recuperar contrasena acepta la peticion pero no llega correo.<br>**Reenvio con pago:** `forwarding.payments: false`, la app no ofrece pagar.<br>**Cobros y tarjeta de Zoho:** Facturacion dice "Online billing isn't set up for your account yet. Please contact your center." |

La app se guia por `GET /client/capabilities`. Los `402`/`403`/`409` se muestran como mensaje.

**Notas para la revision** (App Store Connect → App Review Information):
- cuenta de demostracion;
- servicios fisicos (buzon, recogida, reenvio) facturados fuera de la app por Zoho;
- borrado de cuenta en Settings → Delete Account, que revisa el centro;
- notificaciones desactivadas durante la revision.

## 7. Pendiente fuera de la app

1. ~~Promover HDG Production (fase 1)~~: hecho; `npm run check:hdg-production` da `OK`
   (2026-11-21).
2. Crear la cuenta de demostracion y probar el login desde un dispositivo.
3. Prueba de extremo a extremo de la baja de cuenta en una cuenta sin suscripcion de Zoho (handoff §8).
4. App Store Connect:
   - capturas de iPhone 6,9" hechas con la build de Production (sin franja Sandbox);
   - descripcion, URL de soporte y politica de privacidad (`https://www.hdgexecutivesuites.com/my-hdg-mail-privacy-policy/`);
   - cuestionario de privacidad;
   - clasificacion por edad;
   - declaracion de comerciante de la UE.
5. Decidir quien publica (The Workbox, LLC frente a cuenta propia de HDG): riesgo de las guias 4.2.6/5.2.1.
