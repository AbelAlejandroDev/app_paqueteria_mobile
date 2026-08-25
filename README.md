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
