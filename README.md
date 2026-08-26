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
cp .env.example .env           # y rellena EXPO_PUBLIC_API_URL
npm start
```

## Variables de entorno

| Variable | Descripción |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | Base de la API, incluido `/api/v1`. **Debe ser HTTPS** en release: Android bloquea el tráfico en claro por defecto e iOS lo rechaza por ATS. |
| `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Clave publicable de Stripe (la misma que usa el web). |

## Estado

| Área | Estado |
| --- | --- |
| Monorepo, NativeWind, tokens de marca | ✅ |
| Cliente API con refresh de token | ✅ |
| Login + guardas por rol | ✅ |
| Navegación por tabs | ✅ estructura, pantallas pendientes |
| Kit de UI base | ⬜ |
| Pantallas del portal (11) | ⬜ marcadores en `src/app/(client)/` |
| Stripe PaymentSheet nativo | ⬜ |
| Subida de documentos USPS | ⬜ |
| Push (hoy es polling cada 15 s) | ⬜ |
