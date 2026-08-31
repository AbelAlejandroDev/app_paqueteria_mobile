# Mejoras pendientes

> **Lo más urgente:** [notificaciones push](#0-notificaciones-push-implementadas-sin-verificar)
> está implementado pero **nunca se ha probado**, y no puede probarse sin un
> development build de EAS. Ver también [TLS del VPS](#4-tls-propio-en-el-vps),
> que bloquea repartir la app.

---

## 0. Notificaciones push: implementadas, sin verificar

**Estado:** código completo en ambos lados, cero verificación real.

El cliente debería recibir un aviso en el móvil cuando llega correspondencia,
sin tener que abrir la app. Antes de esto, un paquete registrado solo se veía
si el cliente entraba por su cuenta.

### Qué está hecho

| Pieza | Dónde |
|---|---|
| Tabla de dispositivos | `PushDevice` + migración |
| Envío vía Expo Push | `src/lib/push.js` |
| Disparo automático | `createNotification` |
| Alta y baja del token | `POST /client/push-devices` y `/unregister` |
| Registro en la app | `src/lib/push-notifications.js` |

El push sale **fuera de la transacción y sin `await`**: una llamada a un
servicio externo no debe mantener filas bloqueadas, y si falla, el aviso sigue
guardado y visible dentro de la app.

Solo se envían los tipos de la lista blanca de `push.js`. Quedan fuera a
propósito `FORWARD_LABEL_READY`, que es un paso interno del centro, y
`CLIENT_FORWARDING_ADDRESS_CHANGED`, que va dirigido al staff.

### Por qué no se ha podido probar

**Falta el `projectId` de EAS.** `getExpoPushTokenAsync` lo exige y el proyecto
todavía no está enlazado: hace falta `eas init`. Sin él la app detecta la
situación y no registra nada, en vez de fallar.

**Android no admite push remoto en Expo Go** desde el SDK 53. Hace falta un
development build, que es lo mismo que bloquea repartir la app a clientes.

**iOS necesita la cuenta de Apple Developer** para generar las credenciales de
push. En Android no hay coste.

### Para cerrarlo

1. `eas init` para obtener el `projectId`
2. Development build de Android
3. Registrar un dispositivo real y comprobar que llega el aviso al registrar
   correspondencia
4. Comprobar que al cerrar sesión el dispositivo deja de recibir avisos

### Lo que falta aunque funcione

**Limpieza de tokens viejos.** Se borran los que Expo marca como
`DeviceNotRegistered`, pero nadie descarta los que llevan meses sin abrir la
app. `lastSeenAt` está en la tabla justo para eso.

**Sin registro de envíos.** No se guarda qué se envió ni qué respondió Expo, así
que un "no me llegó" no se puede diagnosticar.

---

Decisiones que se tomaron a propósito para no bloquear el avance, con lo que
costaría cerrarlas bien. No son bugs: son deudas conocidas.

---

## 1. Direcciones de reenvío: dos fuentes de verdad

**Estado:** funcionando, con una copia sincronizada.

Existe la tabla `ForwardingAddress` con varias direcciones por cliente y una
marcada como principal. Pero `ClientProfile` conserva los campos planos
(`addressLine1`, `addressLine2`, `city`, `state`, `zip`), y cada vez que cambia
la principal se reescriben con sus datos.

Se hizo así porque esos campos los leen tres sitios:

- `serializeUser`, que alimenta la app móvil
- la app móvil, en el panel y en Settings
- `createOrUpdateAppClient`, que empareja clientes que llegan de Stripe

**Riesgo:** cualquier escritura futura que toque los campos planos sin pasar por
`syncDefaultToProfile` deja las dos fuentes desincronizadas, y no hay nada que
lo detecte.

**Para cerrarlo:** que `ForwardingAddress` sea la única fuente, y a la vez:

1. `serializeUser` devuelve la dirección desde la tabla
2. la app móvil lee esa forma nueva
3. el portal web de staff, igual
4. `createOrUpdateAppClient` escribe en la tabla
5. se eliminan los campos planos con una migración

El paso 5 no puede ir antes que los otros cuatro: en cuanto se borren, todo lo
que aún los lea empieza a mostrar la dirección vacía.

---

## 2. Envío real de SMS

**Estado:** solo se guarda la preferencia.

`ClientProfile.textAlertsEnabled` persiste lo que el cliente elige, y
`User.phone` guarda el número normalizado a E.164. La API declara
`channels.sms.available: false` y la pantalla lo dice.

**No existe proveedor.** En `config/env.js` solo hay SMTP; no hay ninguna
variable de Twilio ni código que envíe mensajes.

**Para cerrarlo:** cuenta de proveedor con número emisor, variables de entorno,
un servicio de envío, y decidir qué eventos disparan un SMS. Conviene además
registrar los envíos para poder diagnosticar entregas fallidas.

Mientras tanto, la pantalla no debe dar a entender que el cliente recibirá
mensajes.

---

## 3. Teléfono compartido con Stripe

**Estado:** aceptado tras revisarlo.

Text Alerts reutiliza `User.phone` en vez de un campo propio, para no mantener
dos números sincronizados.

Editarlo desde la app **solo escribe en la base de datos**: no hay ninguna
llamada a `stripe.customers.update` en el backend, y `ensureStripeCustomer`
solo lo lee al crear un cliente que todavía no existe.

**Efecto secundario:** `createOrUpdateAppClient` usa el teléfono para emparejar
clientes que llegan de Stripe. Si el cliente lo cambia en la app y después
llega un webhook con el antiguo, esa vía de emparejamiento falla. El email y el
`stripeCustomerId` van antes en el `OR`, así que el emparejamiento sigue
funcionando, pero el teléfono deja de ser fiable para eso.

---

## 4. TLS propio en el VPS

**Estado:** bloqueante para repartir la app.

La app apunta a un túnel gratuito de ngrok, cuya URL **rota sola**. Esa URL va
compilada dentro del binario, así que el día que cambie, todas las apps
instaladas dejan de funcionar y no hay arreglo remoto.

**Para cerrarlo:** dominio propio, registro A al VPS, nginx con certbot,
`client_max_body_size 25M` para las subidas de USPS, backend escuchando en
`127.0.0.1` y retirar el túnel.

Hasta entonces no se puede entregar un build a un cliente real.

---

## 5. Datos históricos sin reparar

**Estado:** el script existe, nunca se ejecutó.

`npm run repair:billing` recupera dos cosas:

- reenvíos cobrados con tarjeta que se quedaron sin `BillingItem`, y por eso no
  aparecen en el extracto
- copias caducadas de la suscripción de Stripe

Va en seco por defecto. Conviene copia de la base de datos antes de aplicarlo.

---

## 6. UI de staff para el historial de Customers

**Estado:** backend listo, interfaz sin conectar.

`GET /staff/clients/:clientId/completed?filter=all|scanned|forwarding|shipments|picked-up|deleted`
ya devuelve los datos con paginación y control de tenant/centro.

El portal web no los consume todavía.

---

## 7. Suites de test que no corren en el clon de referencia

`tests/forwarding` y `tests/uspsCompliance` fallan al arrancar porque al clon
le faltan `@prisma/client` y `dotenv`. No es una regresión, pero significa que
esas dos no se están verificando antes de desplegar.

`forwarding` es la más sensible, porque cubre el ciclo de vida del Mail Item.
Conviene correrla en el VPS antes de cada despliegue.

---

## 8. Versiones de Expo desalineadas

`npx expo install --check` reporta varios paquetes fuera de la versión que
espera el SDK. En desarrollo no molesta, pero un desajuste sí rompe la
compilación en EAS, así que conviene alinearlas antes del primer build.
