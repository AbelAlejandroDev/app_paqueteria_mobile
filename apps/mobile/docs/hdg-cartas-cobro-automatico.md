# HDG — reenvío de cartas y sobres grandes con cobro iniciado por STAFF (contrato definitivo)

Contrato para React Native (cliente) y la web de STAFF. Aplica a HDG Hollywood. En The Worx, GET informa `available: false`, PUT de alta devuelve `409` y se conserva el flujo de Stripe.

## Flujo

```
CLIENTE (app)                                   STAFF (web)                                BACKEND / ZOHO
1. Forward Letter / Request Forwarding
   - fee $5, dirección validada,
     Tracking/Insurance (sin seguro en
     sobre grande)
   - [opcional] autorizar cobro automático
     hasta un MÁXIMO por reenvío
     PUT /client/forwarding/auto-charge-consent
   POST /client/service-requests (FORWARD)  ─►  solicitud "pendiente de preparación"
                                                 2. pesa y mide; POST /staff/forwarding/quotes
                                                    POST /staff/forwarding/quotes/select
                                                    ├─ autorización válida y TOTAL ≤ máximo ─► TOTAL definitivo (no cobra)
                                                    └─ sin autorización, o TOTAL > máximo  ─► el cliente aprueba y paga en la app
                                                 3. "Charge $X" (el total que ve)
                                                    POST …/forward-payment/charge  ────────►  factura de 1 línea + collect con la tarjeta guardada
4. Notificación y estado en la app  ◄──────────────────────────────────────────────────  webhook / relectura → PAID → worker compra la etiqueta
```

**Una tarjeta guardada no es una autorización.** Sin la casilla marcada por el cliente (con el máximo), el STAFF no puede cobrar (`409 FORWARDING_AUTO_CHARGE_NOT_AUTHORIZED`). **Por encima del máximo no se cobra nada solo** (`409 FORWARDING_AUTO_CHARGE_LIMIT_EXCEEDED`): el cliente aprueba y paga en la app.

## Autorización: qué es

- **Reutilizable:** vale para cartas y sobres grandes elegibles del centro. Los paquetes conservan su flujo de cotización y pago por el cliente.
- **Con máximo por reenvío:** el cliente acepta expresamente un importe máximo (TOTAL: Shipping & Handling + Mail Forwarding Fee) dentro del tope que ofrece su centro.
- **Tope del centro = configuración explícita**, no un importe inventado por el código: `FORWARDING_AUTO_CHARGE_MAX_CENTS__HDG__HOLLYWOOD` (centavos, entero > 0). Sin esa variable la autorización **no se ofrece** (`missing: MAX_NOT_CONFIGURED`). Si el tope baja después, el máximo que vale es el menor de los dos.
- **Revocable** en cualquier momento. PostgreSQL ordena la revocación y la reserva de cobro. Después de revocar, STAFF no puede hacer nuevas reservas, incluidos los reintentos. Los intentos ya reservados se concilian.
- **Versionada:** la versión vigente es `HDG-FWD-AUTOCHARGE-2026-11-24.3`. Si cambia el texto, se requiere una nueva aceptación. La autorización anterior queda disponible para retirarla.
- **Atada al centro:** si el cliente cambia de centro, deja de valer (`missing: CENTER_CHANGED`).
- **Aislada por tenant y cliente:** la tabla `ForwardingAutoChargeAuthorization` se consulta siempre con `tenantId` + `clientUserId`; una autorización nunca sirve para otro tenant ni otro cliente.
- **Auditada:** cada autorización es una fila (nunca se edita ni se borra): `grantedAt`, IP, plataforma, versión y huella SHA-256 del texto exacto que vio (con su importe); al retirarla, `REVOKED`; al darla de nuevo, la anterior pasa a `SUPERSEDED`. Además, en el historial del cliente (`ClientLog`, BILLING): `Forwarding Auto-Charge Consent Granted` / `Revoked`, y por cada cobro del STAFF `Forwarding Auto-Charge Started By Staff` con quién, cuánto, con qué autorización y máximo, el resultado y, si hubo subida de precio cubierta por la autorización, el antes y el después.

## Precios (lo que ve el cliente = lo que se factura)

| Concepto | Qué incluye | Dónde se ve |
|---|---|---|
| **Shipping & Handling** | Franqueo real de Pitney (con Tracking/Insurance si se pidieron) + cargo interno de manejo de $2 | Cliente y STAFF |
| **Mail Forwarding Fee** | $5 | Cliente y STAFF |
| **TOTAL** | Shipping & Handling + Mail Forwarding Fee | Cliente y STAFF |
| Desglose interno | Franqueo del transportista y manejo de $2 por separado | Solo STAFF (`staffBreakdown`) |
| Factura de Zoho | **Una** línea `Mail Forwarding Service` por el TOTAL | Zoho |

- **Sin precio parcial:** mientras el STAFF no pesa, la app muestra "Shipping & Handling: confirmed by your center".
- **Mismo importe en todas partes:** el TOTAL que ve el STAFF, el que se cobra y el de la factura son el mismo (`expectedAmountCents` + relectura de la factura).

## Cliente (app)

### Autorización

`GET /client/forwarding/auto-charge-consent`:

```json
{ "available": true, "valid": false, "enabled": false, "missing": "CLIENT_CONSENT",
  "maxOfferedCents": 5000, "maxAmountCents": null, "currency": "USD", "version": "HDG-FWD-AUTOCHARGE-2026-11-24.3",
  "text": "I authorize this center to automatically charge … up to $50.00 USD per shipment …",
  "authorization": null }
```

Con autorización vigente, `enabled` y `valid` son `true`. El `maxAmountCents` de la raíz es el máximo efectivo, el menor del importe aceptado y el tope actual. En otros estados vale `null`. `authorization` es `null` o contiene `{ id, centerId, maxAmountCents, currency, grantedAt, textVersion, text }`. El máximo de ese objeto es el importe originalmente aceptado.

- `text` en la raíz es la oferta actual completa para `maxOfferedCents` y `currency`. Mostrarla tal cual y usar una casilla inicialmente desmarcada. Si cambian texto, versión o importe, pedir que se marque otra vez.
- `authorization.text` contiene el texto histórico con el importe y versión aceptados si coincide con su SHA-256. Puede ser `null` si no se puede verificar. Un registro anterior, de otro centro o con el tope apagado puede aparecer con `valid: false` y sigue siendo revocable.
- En Ajustes de reenvío, mostrar el máximo efectivo con el código de moneda, por ejemplo `$50.00 USD`, y ofrecer retirar la autorización. Los 5000 centavos del ejemplo son ilustrativos.

| Campo | Qué hacer en la app |
|---|---|
| `available: false` | Ocultar el alta. Si existe `authorization`, permitir retirarla. |
| `missing: MAX_NOT_CONFIGURED` | Ocultar el alta. Si existe `authorization`, permitir retirarla. |
| `missing: CLIENT_CONSENT` | Mostrar la casilla con `text` **completo** y el máximo (`maxOfferedCents`). |
| `missing: CONSENT_VERSION_OUTDATED` | El texto cambió: mostrar el nuevo y pedir que lo acepte de nuevo. |
| `missing: CENTER_CHANGED` | Autorización de otro centro: pedirla de nuevo. |
| `valid: true` | Mostrar el máximo efectivo y cómo retirarlo desde Ajustes. |

`PUT /client/forwarding/auto-charge-consent`:
- Darla con `{ "enabled": true, "acceptedVersion": "<version del GET>", "maxAmountCents": <maxOfferedCents del GET> }`. Enviar la versión y el importe de la oferta mostrada. El API admite importes inferiores si la interfaz presenta el texto exacto con ese importe antes de pedir la aceptación.
- Retirarla con `{ "enabled": false }`. El PUT devuelve el mismo contrato de GET. Actualizar la caché con la respuesta. Repetir la retirada es idempotente, incluso con el tope apagado.
- Errores de alta. `409 AUTO_CHARGE_CONSENT_VERSION_MISMATCH` (`currentVersion`), `409 AUTO_CHARGE_MAX_ABOVE_CAP` (`maxOfferedCents`), `400 AUTO_CHARGE_MAX_REQUIRED` cuando falta el importe, y `409 AUTO_CHARGE_NOT_AVAILABLE` (`missing`). Un cuerpo que falla la validación de tipos devuelve `400 Invalid body`.
- Cabecera opcional `x-client-platform` (ios/android): queda en el rastro.

### Pedir el reenvío (carta o sobre grande)

`POST /client/service-requests` (sin cambios para cartas):

```json
{ "type": "FORWARD", "mailItemId": "<id>", "mailItemIds": ["<id>", "…"], "addressId": "<id verificado>",
  "shippingOptions": { "trackingRequested": false, "insuranceRequested": false } }
```

- **`LARGE_ENVELOPE`:** en HDG se acepta como petición, igual que una carta.
  - Va **solo**: con otras piezas, `409 MULTI_FORWARD_LETTERS_ONLY`.
  - **Sin seguro adicional:** si se pide, `422 INSURANCE_NOT_AVAILABLE_FOR_PACKAGES`. Ocultar la casilla de seguro.
- **Paquetes:** siguen por `/client/forwarding/quotes` (`409 FORWARDING_QUOTE_REQUIRED`).
- **Orden:** si el cliente marca la casilla y `valid` era `false`, primero el `PUT` y después el `POST`.

### Estados y qué muestra la app (`forwardDetails`)

| `paymentStatus` | Con autorización y total estimado ≤ máximo | Sin autorización, o total > máximo |
|---|---|---|
| `NOT_STARTED` (sin tarifa) | "Your center is preparing it" | igual |
| `READY_FOR_PAYMENT` | "Your center will charge your saved card (up to $X). You will be notified." **No** mostrar Review & Pay; dejar "Pay now instead" como alternativa | Review & Pay (como hoy) |
| `RECONFIRMATION_REQUIRED` | solo ocurre si la subida pasó del máximo → "Confirm updated price" (como hoy) | "Confirm updated price" |
| `PAYMENT_PENDING` | "Payment processing". Si `prepare-payment` trae `paymentUrl: null` y motivo `COLLECT_IN_PROGRESS` o `COLLECT_UNCONFIRMED`, ofrecer consultar el estado sin presentar otro intento de pago. | igual |
| `FAILED` | "Card declined: update your card or pay in the app" (ofrecer ambas) | igual |
| `PAID` | "Paid — your label is being prepared" | igual |

- **Total estimado en la app:** `(repricedAmount ?? quotedAmountCents) + fee`, con el fee de `GET /client/forwarding/immediate-preview` (`immediateForwardFeeCents`). Comparar con el máximo efectivo solo para cartas y sobres grandes elegibles. Si falta el total, mostrar Review & Pay.
- **Cambios de precio:** dentro del máximo, el STAFF cobra el total recotizado sin pedir nada al cliente. Por encima, el cliente recibe `FORWARD_PAYMENT_REQUIRED` y aprueba y paga en la app (`confirm-repriced-rate` + `prepare-payment`), igual que hoy.

Notificaciones (las de siempre): `FORWARD_LABEL_READY` (pago confirmado; solo dentro de la app, sin push por diseño), `FORWARD_PAYMENT_FAILED` (push), `FORWARD_PAYMENT_REQUIRED` (push: sin tarjeta, o total por encima del máximo), `FORWARD_DISPATCHED` (push).

## STAFF (web)

### Elegir tarifa

`POST /staff/forwarding/quotes/select { serviceRequestId, quoteId, optionId }`. Nunca cobra en Zoho.

- **Autorización válida y TOTAL ≤ máximo:**

```json
{ "autoCharged": false, "awaitingStaffChargeConfirmation": true, "awaitingClientPayment": false,
  "reason": "ZOHO_AUTO_CHARGE_READY", "clientNotified": false,
  "autoCharge": { "authorized": true, "missing": null, "maxAmountCents": 5000, "currency": "USD", "consentAt": "…", "consentVersion": "…", "withinLimit": true, "limitReason": null, "newTotalCents": null },
  "payment": { "amount": 1443, "currency": "USD",
    "clientLines": [ { "key": "SHIPPING_AND_HANDLING", "label": "Shipping & Handling", "amountCents": 943 },
                     { "key": "MAIL_FORWARDING_FEE", "label": "Mail Forwarding Fee", "amountCents": 500 } ],
    "staffBreakdown": { "carrierPostageCents": 743, "handlingCents": 200, "shippingAndHandlingCents": 943, "mailForwardingFeeCents": 500, "totalCents": 1443 },
    "invoiceLine": { "name": "Mail Forwarding Service", "quantity": 1, "amountCents": 1443 } } }
```

- **TOTAL > máximo:** `awaitingClientPayment: true`, `reason: "ZOHO_AUTO_CHARGE_LIMIT_EXCEEDED"`, `autoCharge.withinLimit: false`, `limitReason: LIMIT_EXCEEDED | PRICE_INCREASED_ABOVE_LIMIT | CURRENCY_MISMATCH`, `newTotalCents`. Se avisa al cliente (`FORWARD_PAYMENT_REQUIRED`).
- **Sin autorización:** como antes (`reason: "ZOHO_CLIENT_PAYS_IN_PORTAL"`), más `autoCharge: { authorized: false, missing }`.

### Ver el total

`POST /staff/service-requests/:id/forward-payment/charge-preview` → `{ paymentStatus, autoCharge, payment }` (misma forma). Recotiza en Pitney. Por encima del máximo: `409 FORWARDING_AUTO_CHARGE_LIMIT_EXCEEDED` con `payment` (o `reprice`), sin avisar a nadie.

### Cobrar

`POST /staff/service-requests/:id/forward-payment/charge` con `{ "expectedAmountCents": 1443, "currency": "USD" }`

| Respuesta | Significado | Qué hacer |
|---|---|---|
| `200 { status: "PAID" }` | Pagado y confirmado al releer Zoho. El worker compra la etiqueta | — |
| `200 { status: "DECLINED" }` | Tarjeta rechazada: `FAILED`, sin etiqueta. Se avisa al cliente; la factura queda abierta | Cuando el cliente actualice la tarjeta, volver a cobrar (misma factura) |
| `200 { status: "PROCESSING" }` | Zoho aún no confirmó, o hay otro cobro en curso | **No reintentar**: se concilia solo |
| `200 { status: "NO_SAVED_CARD" }` | Sin tarjeta guardada. Se avisa al cliente | — |
| `409 FORWARDING_TOTAL_CHANGED` (+ `payment`) | El total cambió pero sigue dentro del máximo; **no se ha cobrado** | Enseñar el nuevo total y confirmar de nuevo (sin el cliente) |
| `409 FORWARDING_AUTO_CHARGE_LIMIT_EXCEEDED` (+ `autoCharge`, `payment`/`reprice`) | El total (o el nuevo tras recotizar) pasa del máximo; **no se ha cobrado**; se avisó al cliente | El cliente aprueba y paga en la app |
| `409 FORWARDING_AUTO_CHARGE_NOT_AUTHORIZED` (+ `autoCharge.missing`) | Sin autorización vigente | El cliente paga en la app |
| `409 ZOHO_PAYMENT_IN_PROGRESS` / `503 ZOHO_OUTCOME_UNCERTAIN` | Otro intento en curso o con resultado desconocido | Esperar; nada nuevo cobrado |
| `409 FORWARDING_STAFF_CHARGE_ITEM_NOT_ELIGIBLE` | Paquete, combinación de tipos no elegible o pieza fuera del ámbito de la solicitud | Flujo de pago del cliente para paquetes |
| `409 AUTO_CHARGE_PROVIDER_NOT_SUPPORTED` | Centro con Stripe (The Worx) | Flujo de siempre |

- **Botón bloqueado:** mientras dura la petición y mientras `paymentStatus` sea `PAYMENT_PENDING`.
- **Reintento:** `POST …/forward-payment/retry`. El reintento de STAFF en HDG exige una pieza elegible, autorización vigente y factura abierta dentro del máximo, aunque el cliente hubiera preparado la factura. Durante la conciliación devuelve `409 COLLECT_IN_PROGRESS` o `409 COLLECT_UNCONFIRMED`.

## Garantías

- **Una factura por envío, con una línea.** Un segundo cobro reutiliza la factura abierta.
- **Una sola operación `collect` sin resolver por factura:** la reserva atómica compara la fila vigente. Un timeout, un acuse sin pago verificable y una reserva abandonada sobreviven a reinicios y carecen de vencimiento. Una factura que sigue abierta y sin pagos visibles no establece un rechazo. [Procedimiento de conciliación](../operacion/zoho-forwarding-idempotency.md)
- **PAID solo tras releer Zoho.** `verifyZohoCharge` es la única vía a PAID y la única que encarga la etiqueta. El webhook es idempotente.
- **Guardas que se mantienen:** Tracking/Insurance V2 y la guarda de cobro (`forwardChargeGuard`) antes de cobrar; saldo de Pitney suficiente; modo demo de App Review nunca llega a Zoho.
- **The Worx:** conserva Stripe. El endpoint de consentimiento no ofrece el alta.
- **Base de datos:** una migración, `20261124180000_forwarding_auto_charge_authorization` (solo crea la tabla `ForwardingAutoChargeAuthorization`; no toca filas).
