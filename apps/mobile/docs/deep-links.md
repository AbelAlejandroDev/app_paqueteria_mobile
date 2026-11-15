# Enlaces de activacion, Universal Links y App Links

Estado a 2026-11-15 (rama `feat/mobile-fase-6`).

## Enlaces que manda el backend

`src/config/portalUrls.buildSetPasswordUrl` (backend 348c327), para el alta y para
"olvide mi contraseña":

```
https://<portal-de-miembros>/set-password#token=<t>&email=<e>     (por defecto: fragmento)
https://<portal-de-miembros>/set-password?token=<t>&email=<e>     (SET_PASSWORD_LINK_STYLE=query)
```

La app los lee los dos (`src/lib/activation-link.js`): el fragmento manda, la query
como respaldo, y tambien su esquema propio (`worxclient://` / `hdgclient://`). El token
solo viaja en el cuerpo de `POST /auth/set-password`; no se registra ni se guarda.

Hoy esos enlaces se abren en el **navegador** (el portal web activa la cuenta). Para que
abran la app hacen falta Universal Links (iOS) y App Links (Android).

## Portales

| Marca | Host del portal de miembros | Ficheros `.well-known` hoy |
|---|---|---|
| The Worx | `memberssandlake.theworxoffices.com` | **No**: devuelven el HTML del portal (200 `text/html`) |
| The Worx | `membershallandale.theworxoffices.com` | **No** (igual) |
| The Worx | `membershunterscreek.theworxoffices.com` | **No** (igual) |
| HDG Sandbox | `members.hdgexecutivesuites.com` | **No** (igual) |
| HDG produccion | sin decidir | — |

Comprobado en solo lectura con `curl -D - https://<host>/.well-known/apple-app-site-association`.

## Lo que esta preparado en la app

- `brands/index.js` → `appLinks: { enabled: false, hosts, paths: ["/set-password"] }` por
  marca. Cada marca solo reclama sus portales.
- `app.config.js` → con `enabled: true`: `ios.associatedDomains = ["applinks:<host>"...]`
  y `android.intentFilters` con `autoVerify` para `https://<host>/set-password`.
  Apagado no cambia nada nativo.
- `scripts/deep-link-files.js` → genera `apple-app-site-association` y `assetlinks.json`
  para los hosts de una marca. **Se niega sin el Team ID de Apple y la huella SHA-256
  reales** (no inventa identificadores).

## Pasos para encenderlos (por marca)

1. **Datos reales**
   - Apple Team ID del equipo que firma la app (Apple Developer → Membership).
   - Huella SHA-256 del certificado de firma de Android: `eas credentials` → Android →
     keystore; y, si se publica en Google Play con Play App Signing, tambien la de
     Play Console → App integrity (se pueden poner las dos, separadas por comas).
2. **Generar los ficheros**
   ```bash
   APPLE_TEAM_ID=<team> ANDROID_SHA256=<sha256>[,<sha256-play>] \
     node scripts/deep-link-files.js hdg ./well-known-hdg
   ```
3. **Publicarlos en cada portal.** Los portales los sirve el **backend** (Express, con
   `express.static`, que ignora las rutas con punto, y el `index.html` de la SPA como
   respaldo): hace falta una ruta propia en el backend. Contrato exacto en
   `docs/backend-contract-gaps.md` (fase 7, #1). Requisitos:
   `https://<host>/.well-known/apple-app-site-association` y
   `https://<host>/.well-known/assetlinks.json`, con `Content-Type: application/json`,
   HTTP 200, **sin redirecciones** y sin que la SPA los sustituya por su `index.html`.
4. **Encender** `appLinks.enabled: true` en `brands/index.js`, **subir `RUNTIME_VERSION`**
   (cambia lo nativo) y hacer una build nueva. EAS activa la capacidad Associated
   Domains en el App ID al firmar.
5. **Probar en dispositivo**: abrir el enlace del correo desde Mail/Gmail → abre la app
   en "Crear contraseña" con el correo puesto; `adb shell pm get-app-links
   com.hdgexecutivesuites.clientportal` → `verified`.

Hasta entonces nada se rompe: el enlace sigue abriendo el portal web.
