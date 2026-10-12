# Paquetería — Monorepo

App móvil del **portal de cliente**, portada desde el front web React
(`AbelAlejandroDev/demo`). Staff y superadmin siguen exclusivamente en la web:
esta app cubre solo el rol `CLIENT`.

## Estructura

```
apps/mobile/       Expo SDK 57 · React Native 0.86 · Expo Router · NativeWind
packages/core/     Lógica compartida web ↔ móvil (API, auth, storage, utils)
```

`packages/core` no depende de ninguna plataforma: el almacenamiento se inyecta
en el arranque (`configureStorage`) y el redirect a login se recibe como
callback (`onUnauthorized`). Eso permite que el mismo cliente HTTP con refresh
automático de token sirva para React Native y para la web.

## Marcas (white-label)

Cada marca produce una **app independiente**: su propio identificador de
paquete, nombre en la tienda, esquema de deep link y color. Eso resuelve el
problema de qué branding mostrar *antes* del login, cuando el servidor todavía
no sabe quién es el usuario.

El catálogo está en [apps/mobile/brands/index.js](apps/mobile/brands/index.js) y
es la única fuente de verdad: lo consumen `app.config.js` (identidad de la app),
`tailwind.config.js` (color primario horneado en el tema) y `src/lib/brand.js`
(lectura en runtime).

| Marca | `APP_BRAND` | Bundle ID |
| --- | --- | --- |
| The Worx Offices | `the_worx` (por defecto) | `com.theworxoffices.clientportal` |
| HDG Executive Suites | `hdg` | `com.hdgexecutivesuites.clientportal` |

```bash
npm start                 # The Worx (marca por defecto)
npm run start:hdg         # HDG
eas build --profile worx-production --platform android
eas build --profile hdg-production --platform android
```

El **nombre y el color** van horneados en el build, así que se ven desde el
primer arranque. El **logo** llega del servidor en `user.branding.logoUrl` una
vez hay sesión, de modo que un cambio en el panel de admin se refleja sin
republicar la app.

Para añadir una marca: una entrada en `brands/index.js` y, opcionalmente, sus
iconos en `apps/mobile/assets/brands/<id>/` (si no existen, se usan los
compartidos).

## Requisitos

- Node >= 20.19.4 (probado con 24.19.0)
- Expo Go, o un emulador de Android / simulador de iOS

## Arranque

```bash
npm install                    # desde la raíz: instala todos los workspaces
cd apps/mobile
cp .env.example .env           # ya apunta a la API oficial
npm start
```

## Variables de entorno

| Variable | Descripción |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | Base de la API, incluido `/api/v1`. **Debe ser HTTPS** en release: Android bloquea el tráfico en claro por defecto e iOS lo rechaza por ATS. |
| `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Clave publicable de Stripe (la misma que usa el web). |

La API oficial es `https://core.theworxoffices.com/api/v1` en todos los casos.
`src/lib/api.js` falla al arrancar si falta la variable: no hay URL de reserva a
propósito, para que un build mal configurado se note en vez de apuntar a otro
sitio.

**Builds de EAS.** El `.env` está en `.gitignore` y EAS no lo sube, así que los
builds no lo leen. Cada perfil base de `eas.json` declara su `environment` y la
variable vive en las EAS Environment Variables de **cada proyecto de marca**
(The Worx y HDG son proyectos distintos en expo.dev):

| Perfil | Environment de EAS |
| --- | --- |
| `*-development` | `development` |
| `*-preview`, `*-simulator` | `preview` |
| `*-production` | `production` |

**EAS Update.** Publica siempre con `--environment` igual al del canal. Sin él,
el bundle se genera con el `.env` local de quien publica:

```bash
eas update --channel production --environment production --message "..."
eas update --channel preview --environment preview --message "..."
eas update --channel development --environment development --message "..."
```

Con `APP_BRAND=hdg` delante para publicar la de HDG.

## Estado

| Área | Estado |
| --- | --- |
| Monorepo, NativeWind, tokens de marca | ✅ |
| Cliente API con refresh de token | ✅ |
| Login + guardas por rol | ✅ |
| Navegación por tabs | ✅ |
| Kit de UI base | ✅ |
| Dashboard, Mail Items (lista y detalle) | ✅ |
| Billing (Usage / Statement / Payment) | ✅ |
| Settings, Help, Set Password | ✅ |
| USPS Verification | ✅ interfaz; subida sin probar contra el backend |
| Portal de pago de Stripe | ✅ vía navegador in-app, sin SDK nativo |
| New Service Request | ⬜ marcador, inalcanzable igual que en el web |
| Push (hoy es polling cada 15 s) | ⬜ |
| TLS propio en el VPS (`core.theworxoffices.com`) | ✅ |
