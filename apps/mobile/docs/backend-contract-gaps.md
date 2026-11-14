# Huecos del contrato del backend para la app movil

## Estado tras backend `348c327` (2026-11-14, rama `feat/mobile-fase-4`)

| Propuesta | Estado | En la app |
|---|---|---|
| 1. Capacidades sin `Origin` | **Resuelta**: `GET /client/capabilities` (contrato v1, `docs/mobile/capacidades-y-health.md`) | Fuente principal (`src/lib/capabilities.js`, `use-capabilities.js`). `/public/portal` ya no hace falta |
| 2. Ruta de salud | **Resuelta**: `GET|HEAD /api/v1/health` → `200 {"status":"ok"}` | Sonda de conectividad (`PROBE_PATH = "/health"`, `isHealthyResponse`) |
| 3. Señal de mantenimiento | Respondida: no hay modo propio; en una parada responde Traefik (502/503/504) | Ya era el comportamiento (`availability.js`) |
| 4. `returnUrl` a la app desde Zoho | Respondida: no hace falta; la vuelta se detecta con `AppState` + `payment-status` cada ≥ 15 s | Implementado (`zoho-forward-payment.js`) |
| Motivo del fallo de pago / marca de tarjeta | Siguen abiertos (opcionales) | — |

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
