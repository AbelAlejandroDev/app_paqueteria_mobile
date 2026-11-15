# Notificaciones push: estado y configuracion pendiente

Estado a 2026-11-15 (rama `feat/mobile-fase-6`). Nada de esto se ha configurado
fuera del repositorio: son los pasos manuales que faltan.

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

## The Worx

| Pieza | Estado |
|---|---|
| Android: `assets/brands/the_worx/google-services.json` | En el repo (identificadores publicos de Firebase, no secretos) |
| Android: clave de cuenta de servicio **FCM v1** en EAS (`worx-client`) | **Comprobar** con `eas credentials` → Android → Push Notifications. Sin ella Expo no puede entregar en Android |
| iOS: clave **APNs** (.p8) en EAS (`worx-client`) | **Comprobar** con `eas credentials` → iOS → Push Notifications. Hay builds de tienda, asi que probablemente existe |

## HDG (Sandbox)

| Pieza | Estado | Que hacer |
|---|---|---|
| Proyecto Firebase de HDG | **No existe en el repo** | Crear (o usar) un proyecto Firebase de HDG y registrar la app Android `com.hdgexecutivesuites.clientportal` |
| `assets/brands/hdg/google-services.json` | **Falta** | Descargarlo de esa app de Firebase y añadirlo (es publico; ninguna clave privada). `app.config.js` lo detecta solo y `extra.push.androidFcmConfigured` pasa a `true` |
| Clave FCM v1 en EAS (`hdg-client`) | **Falta** | Firebase → Cuentas de servicio → generar clave JSON → `eas credentials` (Android, perfil de HDG) → subirla. **Esa clave no va a Git** |
| Clave APNs en EAS (`hdg-client`) | **Falta** (no hay ninguna build de HDG) | Al primer `eas build` de iOS (fase 7) EAS ofrece crearla con la cuenta de Apple; o crear una clave APNs en Apple Developer y subirla con `eas credentials` |
| Subir `RUNTIME_VERSION` | **Al añadir `google-services.json`** | Cambia lo nativo de Android: `tests/native-runtime.test.mjs` lo exige |

Mientras falte `google-services.json`, la app de HDG en Android **no intenta**
registrarse y lo explica ("Android notifications are not configured for this app yet
(Firebase)"). En iOS no depende de Firebase.

## Que se ha probado sin dispositivo

`tests/push-navigation.test.mjs`, con simulaciones:

- Primer plano: con sesion se enseña el aviso; sin sesion, nada.
- Toque con la app abierta, en segundo plano (esperando al desbloqueo biometrico) y
  con la app cerrada (leido al arrancar, esperando a la sesion, sin abrirse dos veces).
- Sin sesion no se navega; si entra otra cuenta, el toque pendiente se descarta.
- Cada tipo con push del backend (`PUSHABLE_TYPES`) lleva a una pantalla que existe;
  ids raros no componen rutas; correo, escaneos, forwarding, cobros fallidos y
  facturacion van a su sitio; el cobro fallido de un escaneo decide por el proveedor.

## Lo que necesita dispositivo fisico y credenciales

No se puede simular: requiere un telefono real (los simuladores no tienen push), una
build de desarrollo o interna (no Expo Go) y las credenciales de arriba.

| Prueba | Android | iOS |
|---|---|---|
| Permiso de notificaciones y registro (`POST /client/push-devices` → 201) | FCM de la marca | APNs de la marca |
| Recepcion con la app delante, en segundo plano y cerrada | si | si |
| Toque en cada estado abre la pantalla correcta | si | si |
| Logout → `unregister` → no llegan mas avisos de esa cuenta | si | si |
| Otra cuenta en el mismo telefono no ve avisos de la anterior | si | si |
| Aviso de HDG nunca llega a la app de The Worx (y al reves) | si | si |
| Canal "Mailbox alerts" (Android) y sonido | si | — |
| Bloqueo biometrico: el toque espera al desbloqueo | si | si (Face ID) |

Enviar avisos de prueba requiere **cuentas de prueba** en The Worx y HDG Sandbox y
generarlos desde el backend o el panel (p. ej. registrar una pieza de prueba). No se
debe usar la herramienta de Expo con tokens de clientes reales.
