# Huecos del contrato del backend para la app movil

## Estado tras backend `348c327` (2026-11-14, rama `feat/mobile-fase-4`)

| Propuesta | Estado | En la app |
|---|---|---|
| 1. Capacidades sin `Origin` | **Resuelta**: `GET /client/capabilities` (contrato v1, `docs/mobile/capacidades-y-health.md`) | Fuente principal (`src/lib/capabilities.js`, `use-capabilities.js`). `/public/portal` ya no hace falta |
| 2. Ruta de salud | **Resuelta**: `GET|HEAD /api/v1/health` → `200 {"status":"ok"}` | Sonda de conectividad (`PROBE_PATH = "/health"`, `isHealthyResponse`) |
| 3. Señal de mantenimiento | Respondida: no hay modo propio; en una parada responde Traefik (502/503/504) | Ya era el comportamiento (`availability.js`) |
| 4. `returnUrl` a la app desde Zoho | Respondida: no hace falta; la vuelta se detecta con `AppState` + `payment-status` cada ≥ 15 s | Implementado (`zoho-forward-payment.js`) |
| Motivo del fallo de pago / marca de tarjeta | Siguen abiertos (opcionales) | — |

## Fase 7 (2026-11-15, rama `feat/mobile-fase-7`): dependencias del VPS / backend

### 1. Servir `/.well-known/` en los portales (Universal Links / App Links)

**Por que no basta con el frontend.** Los portales los sirve el backend
(`src/app.js`): `express.static(FRONTEND_DIST_PATH)` para los hosts de portal y, si no
encuentra el fichero, el `index.html` de la SPA. `express.static` **ignora por defecto las
rutas con punto** (`dotfiles: "ignore"`), asi que `/.well-known/...` cae en el
`index.html` aunque el frontend incluyera los ficheros en su `dist` (comprobado: hoy
responden `200 text/html`). Y `apple-app-site-association` no tiene extension, asi que
saldria como `application/octet-stream`.

**Contrato propuesto** (en `src/app.js`, antes del estatico y del fallback de la SPA):

```
GET|HEAD /.well-known/apple-app-site-association
GET|HEAD /.well-known/assetlinks.json
```

- Solo en hosts de **portal de miembros** (`isFrontendPortalHost` + portal MEMBER); en
  cualquier otro host, `404`.
- El contenido depende del **tenant del host** (`resolveHostname(host).tenantSlug`):
  `memberssandlake/hallandale/hunterscreek.theworxoffices.com` → The Worx;
  `members.hdgexecutivesuites.com` → HDG.
- `Content-Type: application/json`, `200`, sin redireccion, `Cache-Control: public,
  max-age=3600`.
- Datos por tenant desde la configuracion del despliegue (no secretos):
  `APPLE_TEAM_ID__<TENANT>`, `IOS_BUNDLE_ID__<TENANT>`, `ANDROID_PACKAGE__<TENANT>`,
  `ANDROID_SHA256__<TENANT>` (lista separada por comas). Sin ellos, `404` (nunca un
  fichero a medias).
- Cuerpos: exactamente los que genera `apps/mobile/scripts/deep-link-files.js` (rama
  movil): AASA con `appIDs: ["<TEAM>.<bundle>"]` y `components: [{ "/": "/set-password" }]`;
  `assetlinks.json` con `delegate_permission/common.handle_all_urls`, `package_name` y
  `sha256_cert_fingerprints`.

Hasta entonces la app los tiene apagados y los enlaces abren el portal web.

### 2. Baja del push sin sesion (opcional: la app ya lo cubre)

**Lo que hace la app desde esta fase:** al cerrar sesion, si
`POST /client/push-devices/unregister` falla (sin red), invalida el token **en el propio
dispositivo** (`expo-notifications unregisterForNotificationsAsync`): no llegan mas avisos
y el backend borra el token cuando Expo responde `DeviceNotRegistered`. Si ni eso se puede
(Android sin red), queda marcado y se reintenta al arrancar sin sesion. Solo afecta a este
telefono.

**Defensa adicional propuesta** (no imprescindible): un secreto por dispositivo para dar de
baja SIN sesion y sin poder tocar dispositivos ajenos.

- `POST /client/push-devices` (con sesion) devuelve ademas `revocationSecret` (32 bytes
  aleatorios, base64url); el backend guarda solo `sha256(secret)` en la fila del token.
  Cada registro (o reasignacion a otro usuario) genera uno nuevo e invalida el anterior.
- `POST /public/push-devices/revoke` (sin sesion) `{ token, revocationSecret }` →
  `204` si coincide el hash (borra la fila), `204` tambien si no existe (no revela nada),
  `400` si el cuerpo es invalido; con limite de intentos por IP. Nunca acepta `userId`.
- La app guardaria el secreto en SecureStore junto a los tokens y lo usaria en el
  reintento al arrancar.

### 3. Riesgo en la app: resuelto en `chore/mobile-cierre-tecnico`

El visor de PDF cargaba **pdf.js desde `cdn.jsdelivr.net`** dentro del WebView que
recibe el escaneo. Ahora va empaquetado (`src/vendor/pdfjs`, generado y verificado por
SHA-256 con `scripts/vendor-pdfjs.js`) y el WebView no tiene red (CSP sin conexiones,
origen `https://pdf-viewer.invalid`, navegaciones bloqueadas): `src/lib/pdf-html.js`.

---

## Fase 5 (2026-11-15, rama `feat/mobile-fase-5`): pendientes del backend

Revisado contra `348c327` (`approveScan.js`, `checkoutSession.js`,
`forwardingPayments.createForwardingCheckoutSession`, `cancelPaymentIntentIfPossible`,
`stripe/webhook.js`). Nada cambiado en el backend; la app mitiga lo que puede.

| # | Hallazgo | Riesgo | Mitigacion en la app | Propuesta minima al backend |
|---|---|---|---|---|
| 1 | `checkout-session` crea otra sesion aunque el PaymentIntent anterior ya este `succeeded`: `cancelPaymentIntentIfPossible` solo cancela `requires_*`/`processing` y si no, sigue | **Doble cobro** si el cliente paga, vuelve y paga otra vez antes de que llegue el webhook (el estado sigue `PAYMENT_PENDING`) | Con `PAYMENT_PENDING` primero se lee `payment-status`; "Pay again" pide confirmacion explicita ("could charge you twice"); candado contra doble pulsacion | Antes de crear la sesion, si el PaymentIntent guardado esta `succeeded` o `processing`, responder `409 FORWARDING_PAYMENT_IN_PROGRESS` (o confirmar el pago) en vez de abrir otro Checkout |
| 2 | No se procesa `checkout.session.expired` | Un Checkout abandonado deja `PAYMENT_PENDING` indefinidamente; la app no puede distinguir "abandonado" de "pagado sin webhook" | La confirmacion de #1 | Al expirar la sesion, volver a `READY_FOR_PAYMENT` (o exponer `checkoutExpiresAt` en `forwardDetails`) |
| 3 | `approve-scan` responde `409 { reason: "Online payments are not available..." }` **sin `code`** | La app tiene que reconocer el texto | Se compara el texto | Añadir `code: "ONLINE_PAYMENTS_UNAVAILABLE"` |
| 4 | Tras `402 Payment failed` de `approve-scan`, la solicitud queda `IN_PROGRESS` y el cliente no ve por que (`scanDetails` no expone `paymentError` ni estado de factura) | Al reabrir la pieza no se sabe que el escaneo espera pago | El aviso `SCAN_PAYMENT_FAILED` (alertas de pago) y, en HDG, la factura `SCAN` en Facturacion | Exponer `scanDetails.paymentStatus` (`PENDING_PAYMENT`/`PAID`) al cliente |
| 5 | Con Zoho, el `402` de `approve-scan` no trae el `invoiceId` de Zoho | No se puede abrir directamente esa factura | Se lleva a Facturacion | Incluir `zohoInvoiceId` (o la referencia `MW-SCAN-*`) |

---

Lo que sigue es el analisis original (backend `dac158a`), conservado como historia.

---

Contra backend `main` `dac158a` (app_paqueteria) y su handoff
`docs/operacion/HDG_MOBILE_HANDOFF.md`. Estado a 2026-11-13, rama `feat/mobile-fase-2-3`.
Nada de esto se ha cambiado en el backend: son propuestas para su equipo.

## 1. `GET /public/portal` depende de `Origin` (bloquea `services.*`, `forwardingCheckout` y `deployment`)

**Problema.** `/public/portal` solo responde si `portalContextMiddleware` resuelve un
portal de centro por `Origin` → `Referer` → `Host`. Una app nativa no manda `Origin`,
y el `Host` de la API (`core.theworxoffices.com`, `core.hdgexecutivesuites.com`) no es
un portal: la respuesta es `404 { error: "Portal not found" }`.

Enviar a mano `Origin: https://members...` **no** es una solucion aceptable:

- Es suplantar al portal web: con `CORS_STRICT=true` se rechaza un `Origin` desconocido,
  y uno conocido activa las comprobaciones `PORTAL_*_MISMATCH` de login
  (`src/lib/portalAccess.js`), pensadas para el navegador.
- Obliga a la app a conocer el host del portal de cada centro (configuracion de
  servidor, `PORTAL_MEMBER_HOST__HDG__HOLLYWOOD`), que puede cambiar sin publicar la app.
- iOS (NSURLSession) puede ignorar o reescribir cabeceras como `Origin`.

**Lo que hace hoy la app** (`src/lib/capabilities.js`): no llama a `/public/portal`
(`PUBLIC_PORTAL_SOURCE = { available: false, reason: "PUBLIC_PORTAL_REQUIRES_ORIGIN" }`).
Usa `GET /client/billing/payment` (proveedor, pagos, portal de Stripe, datos de Zoho)
y `availableActions` de cada pieza (que ya respeta `services.forwarding` y la mora).
`services`, `forwardingCheckout` y `deployment` quedan en `null` ("no se sabe"), y la
app no los rellena por su cuenta. `deriveCapabilities` ya acepta la respuesta del
portal: en cuanto haya una fuente autenticada, solo cambia la llamada.

**Cambio minimo propuesto** (una ruta nueva, reutilizando lo que ya existe):

```js
// src/routes/client/capabilities.routes.js
router.get("/client/capabilities", authMiddleware, requireClient, async (req, res, next) => {
  try {
    const mailbox = await prisma.mailbox.findFirst({
      where: { clientUserId: req.user.id, tenantId: req.user.tenantId },
      select: { center: { select: { slug: true, tenant: { select: { slug: true } } } } },
    });
    const tenantSlug = mailbox?.center?.tenant?.slug;
    const centerSlug = mailbox?.center?.slug;
    if (!tenantSlug || !centerSlug) return res.status(404).json({ error: "Center not found" });
    res.json({
      center: { slug: centerSlug },
      billing: publicBilling(billingCapabilitiesForCenter(tenantSlug, centerSlug)), // el de portal.js
      services: portalServices(tenantSlug, centerSlug),                             // jobPolicies.js
      ...(deploymentFrom(process.env) === "sandbox" ? { deployment: "sandbox" } : {}),
    });
  } catch (err) { next(err); }
});
```

- Misma forma que `/public/portal` para `billing`, `services` y `deployment`: la app
  la pasa tal cual a `deriveCapabilities` como `publicPortal`.
- Sin llamar a Zoho (a diferencia de `/client/billing/payment`, que lee tarjetas y
  facturas de Zoho en cada peticion): barato de refrescar al volver a primer plano.
- El centro sale de la sesion, nunca del cuerpo ni de cabeceras.

Alternativa aun mas pequeña, peor: añadir `services` y `deployment` a la respuesta de
`GET /client/billing/payment`. Funciona, pero ata las capacidades a una ruta que con
Zoho hace llamadas externas.

## 2. Ruta de salud

No hay `GET /api/v1/health`. La sonda de la pantalla de "servicio no disponible"
(`createApiProbe`, `packages/core/src/api.js`) usa `GET /auth/me` **sin token**:
`authMiddleware` responde 401 JSON al momento, sin tocar la base de datos, y eso prueba
que el backend esta vivo. Funciona, pero ensucia los registros con 401.

**Propuesta:** `GET /api/v1/health` publica → `200 { ok: true }`, sin base de datos ni
terceros. La app solo cambiaria `PROBE_PATH`.

## 3. Señal de mantenimiento

Hoy un corte llega como 502/503/504 de Traefik (sin el JSON del backend), y la app lo
trata como "servicio no disponible" (`packages/core/src/availability.js`). Un 5xx **con**
el JSON del backend (`{ error, code }`) se trata como error de esa peticion, porque el
backend usa 503/502 para cosas concretas (Pitney, Zoho).

**Propuesta:** si algun dia hay una pagina o respuesta de mantenimiento planificado,
que sea un 503 **sin** cuerpo JSON de error (o HTML), con `Retry-After`. Si se quiere
JSON, acordar antes un `code` (p. ej. `SERVICE_MAINTENANCE`) para que la app lo
reconozca; hoy la app no da por hecho ninguno.

## 4. Ya conocidos (handoff G.7), siguen abiertos

- Ninguna ruta de Zoho acepta un `returnUrl` hacia la app: la vuelta de las paginas de
  Zoho va al portal web. La app tendra que detectarla al cerrarse el navegador.
- `payment-status` y `forwardDetails` no exponen el motivo de un fallo de pago.
- `zoho.cards[]` no trae la marca de la tarjeta (solo `last4`, caducidad y `gateway`).
