# My HDG Mail: App Store y Google Play (preparacion, sin enviar)

Estado a 2026-11-22. Base movil `f582496` (OTA Sandbox `01a2035d` Android / `01a2035f` iOS).
Complementa `docs/hdg-production-app-review.md` (builds, demo, fase 1) y no lo sustituye.
Nada de esto se ha enviado a ninguna tienda.

## 1. Lo que ya tiene la app

| Requisito | Estado | Donde |
|---|---|---|
| Nombre bajo el icono | `My HDG Mail` | `brands/index.js` (`appName`) |
| App ID / package | `com.hdgexecutivesuites.clientportal` (iOS y Android) | `brands/index.js` |
| Version | `1.0.0`; numeros de build remotos en EAS (`appVersionSource: remote`, `autoIncrement` en production) | `app.config.js`, `eas.json` |
| Icono | 1024x1024 sin canal alfa (App Store); adaptativo y monocromo en Android | `assets/brands/hdg/` |
| Splash | Logo sobre blanco | `app.config.js` (`expo-splash-screen`) |
| Dispositivos iOS | Solo iPhone (`supportsTablet: false`) | `app.config.js` |
| Cifrado | `ITSAppUsesNonExemptEncryption = false` (solo HTTPS) | `app.config.js` |
| Permisos iOS | Camara y fotos (documentos USPS 1583), Face ID; sin microfono | `app.config.js` |
| Permisos Android | Camara, biometria, notificaciones; `RECORD_AUDIO` y `SYSTEM_ALERT_WINDOW` retirados | `app.config.js` |
| Target SDK Android | 36 (APK `b07a8dcf`) | SDK 57 |
| Sin SDKs de analitica, anuncios ni rastreo | Ninguno en `package.json` | — |
| Inicio de sesion | Email y contrasena; las cuentas las crea el centro (no hay registro en la app) | `src/app/login.jsx`, `set-password.jsx` |
| Borrado de cuenta en la app | Settings → Delete Account: solicitud que revisa el centro; lo que se borra y lo que se conserva lo manda el backend (`retention`) | `settings/delete-account.jsx` |
| Cerrar sesion | Settings → Sign out (con confirmacion) | `settings/index.jsx` |
| Soporte | Help: email y telefono del centro, si el backend los da | `help/index.jsx` |
| Politica de privacidad | Login (`/public/legal`) y Settings → Legal (`capabilities.legal`). **Hoy el backend responde `null`: no se ve en ningun sitio** | `lib/legal-links.js` |
| Pagos | Paginas alojadas de Stripe/Zoho en el navegador; nada de In-App Purchase. En fase 1 (`forwarding.payments: false`) no se ofrece pagar | `components/common/*payment*` |
| Push | APNs `46PKSW3B6D` y FCM v1 (`my-hdg-mail-f00be`) en EAS | `docs/push-setup.md` |
| Firma Android | Keystore de subida en EAS (`hdg-client`); Play App Signing al crear la app | `docs/hdg-production-app-review.md` §3 |

## 2. Pagos y las reglas de Apple (3.1)

La app no vende contenido digital ni desbloquea funciones dentro de la app. Lo que se paga:

- **Membresia del buzon** (direccion fisica, recepcion de correo): servicio del mundo real,
  facturado por el centro en Zoho. La app solo muestra facturas y abre la pagina segura de Zoho.
  No se compra ni se mejora un plan en la app.
- **Reenvio**: franqueo y manipulacion de un envio fisico (3.1.5(a), bienes y servicios
  consumidos fuera de la app). Stripe Checkout o Zoho, en el navegador.
- **Escaneo**: una persona del centro abre y escanea correo fisico, y el PDF se ve en la app.
  Es un servicio humano sobre un objeto fisico, pero el resultado se consume en la app: es el
  unico punto discutible. **Decision comercial pendiente** (ver §7, riesgo R5).

Conclusion: In-App Purchase no corresponde a membresia ni reenvio. El escaneo conviene explicarlo
en las notas de revision.

## 3. Privacidad: declaraciones (borrador; lo confirma quien responde legalmente)

Datos que la app maneja (vinculados a la identidad, ninguno para rastreo ni publicidad):

| Dato | Para que | Apple (App Privacy) | Google (Data Safety) |
|---|---|---|---|
| Nombre, email, telefono | Cuenta y contacto | Contact Info | Personal info: name, email, phone |
| Direcciones de reenvio y destinatarios | Enviar correo y paquetes | Contact Info: physical address | Personal info: address |
| Form 1583 y dos documentos de identidad (fotos o PDF) | Requisito USPS para recibir correo de terceros | User Content: photos / other user content | Photos; Files and docs; Personal info: other |
| Fotos y escaneos del correo recibido | Servicio principal | User Content (los genera el centro) | Photos; Files and docs |
| Historial de solicitudes, facturas, pagos | Servicio y facturacion | Purchases | Financial info: purchase history |
| Datos de tarjeta | Los introduce el cliente en Stripe/Zoho, fuera de la app; la app solo ve los 4 ultimos digitos | No los recoge la app (confirmar) | No los recoge la app (confirmar) |
| Token de notificaciones | Avisos push | Identifiers: device ID | Device or other IDs |
| Face ID / huella | Desbloqueo local; nunca sale del dispositivo | No es recogida | No es recogida |

- Cifrado en transito: si (HTTPS).
- Borrado: si, por solicitud (en la app y por la web: §5).
- Sin rastreo (ATT no aplica) y sin anuncios.

## 4. Cuenta de demostracion

Ya definida en `docs/hdg-production-app-review.md` §5:
- `appreview@hdgexecutivesuites.com`;
- buzon `A-9001`;
- piezas `DEMO01`–`DEMO05`.

**Pendiente: crearla en Production y probar el login.**

| Se puede revisar | Como |
|---|---|
| Login, dashboard, buzon, piezas (fotos, PDF), avisos, historial | Datos del seed |
| Detalle de carta y de paquete | Las piezas demo deberian incluir al menos una carta, un `LARGE_ENVELOPE` y un `PACKAGE` (confirmar el seed) |
| Pedir escaneo | UMS de demostracion sin cargo |
| Reenvio: formulario, Add Tracking, Add Insurance (cartas), estado vacio de paquetes | Hasta Get Rates; en fase 1 no hay pago |
| Borrado de cuenta | La pantalla y su explicacion; **no enviar** la solicitud desde la demo, o restaurarla despues |

No se puede (y se dice en las notas): pagos, etiquetas, push, correos y SMS.

Sin acceso de staff ni administrador.

## 5. Borrado de cuenta por la web (Google Play)

Google pide una URL que funcione sin la app. Lo que existe en el codigo:
- el portal tiene la funcion (`feat/account-deletion-requests`);
- `members.` es una SPA y no se pudo comprobar una pagina publica.

Opciones (decide HDG):
1. **Recomendado.** Pagina publica en `www.hdgexecutivesuites.com`:
   - como pedir el borrado (portal → menu de cuenta, o email al centro);
   - que se borra y que se conserva, con el mismo texto que el backend en `retention`.
2. La ruta del portal con sesion, si los clientes tienen acceso web.

No escribir el texto de retencion sin que lo apruebe HDG: tiene que coincidir con el backend.

## 6. Material para las tiendas (ingles, borrador)

Limites de caracteres verificados con `node` al escribirlos.

**App name** (Apple 30 / Google 30): `My HDG Mail` (11)

**Subtitle** (Apple, 30): `Your HDG mailbox, anywhere` (26)

**Short description** (Google, 80):
`See your mail and packages at HDG Executive Suites and choose what happens next.` (80)

**Keywords** (Apple, 100, sin espacios tras la coma):
`mailbox,mail,packages,scan,forwarding,virtual address,USPS 1583,executive suites,coworking,HDG` (94)

**Promotional text** (Apple, 170):
`Get notified when mail or a package arrives at HDG Executive Suites, view photos and scans, and request forwarding, pickup or discard from your phone.` (150)

**Full description** (Apple y Google, 4000):

```
My HDG Mail is the mobile companion for HDG Executive Suites mailbox clients.

When mail or a package arrives for you at your HDG center, it appears in the app. From there you decide what happens next.

YOUR MAILBOX
• See every letter, large envelope and package received for your mailbox, with photos of the outside
• Open scanned documents right in the app
• Browse your mail by folder and see at a glance what is new

REQUEST SERVICES
• Ask your center to scan a letter
• Request forwarding to one of your saved addresses, with optional Add Tracking
• Schedule a pickup at the center
• Ask to discard items you don't need
• Follow every request in your history

STAY INFORMED
• Notifications when mail arrives or a request changes
• In-app notices from your center

YOUR ACCOUNT
• Upload your USPS Form 1583 and the required ID documents
• Manage forwarding addresses and authorized individuals
• Review your plan, invoices and fee schedule
• Unlock with Face ID or fingerprint
• Request account deletion from Settings

My HDG Mail requires an active mailbox with HDG Executive Suites. Accounts are created by your center; use the email and password they set up for you.
```

No menciona seguros ni cobertura.

**Antes de publicar, cotejar con Production:**
- las carpetas del buzon (no hay busqueda; no anunciarla);
- los avisos que de verdad se envian;
- que el centro ofrezca pickup y discard;
- si "Add Insurance" para cartas se quiere anunciar. No se anuncia: solo se ve al pedir el reenvio.

**Release notes 1.0.0**: `First release of My HDG Mail.`

**App Review Notes** (App Store Connect; Google Play → App access):

```
Sign-in is required. Demo account: appreview@hdgexecutivesuites.com (password entered in the credentials field). It is a demo mailbox with sample mail items; no real customer data.

My HDG Mail is for clients of HDG Executive Suites, a physical office and mailbox provider. Accounts are created by the center; there is no sign-up in the app.

Payments: the app does not sell digital content. Mailbox membership, mail forwarding (postage and handling) and mail scanning are real-world services performed by center staff on physical mail. They are billed by the center and paid on secure hosted pages (Stripe or Zoho) outside the app. Online payment is disabled for the demo account, so no charges or shipping labels can be created.

During review, push notifications, emails and SMS are not sent from this environment. "Forgot password" accepts the request but no email is delivered.

Account deletion: Settings > Delete Account. It sends a deletion request that the center reviews; the screen explains what is deleted and what must be kept by law.
```

**Capturas recomendadas** (build de Production, cuenta demo, sin franja Sandbox):
- iPhone 6,9" (1320x2868), de 3 a 10;
- Google, telefono, de 2 a 8, 9:16;
- Google ademas: icono 512x512 y grafico destacado 1024x500 (no existen todavia).

Orden:
1. dashboard con avisos;
2. buzon (lista);
3. detalle de un paquete con foto;
4. escaneo PDF abierto;
5. reenvio con Add Tracking;
6. historial de solicitudes;
7. verificacion USPS 1583;
8. Settings (Delete Account visible).

Categoria: Apple **Business** (secundaria Productivity); Google **Business**.

## 7. Riesgos de rechazo

| # | Riesgo | Tienda | Que lo evita |
|---|---|---|---|
| R1 | La app se publica desde **The Workbox, LLC** (`3KX6P6C79Q`), el mismo equipo que My Worx Mail, con el mismo codigo: guia **4.2.6** (apps de plantilla las envia el dueño del contenido) y **4.3** (spam) | Apple | Publicar desde una cuenta de desarrollador de HDG, o documentar que The Workbox opera el servicio de HDG. **Decision de negocio** |
| R2 | Politica de privacidad: `/public/legal` y `capabilities.legal` devuelven `null` en Production; la app no enseña ningun enlace (5.1.1(i)) | Ambas | Backend: `PRIVACY_POLICY_URL__HDG=https://www.hdgexecutivesuites.com/privacy-policy/` en Production |
| R3 | No existe la cuenta demo en Production (2.1) | Ambas | Seed `appreview` y probar el login |
| R4 | "Forgot password" sin correo en fase 1: el revisor lo ve como fallo (2.1) | Apple | Explicarlo en las notas (ya en el borrador) o activar el correo |
| R5 | Escaneo pagado dentro de la app (3.1.1) cuando se activen los pagos | Apple | Hoy apagado; antes de activarlo, decidir si el escaneo se factura como servicio del centro (fuera de la app) |
| R6 | Sin URL web de borrado de cuenta | Google | §5 |
| R7 | Cuenta de Play Console personal creada despues de nov. 2023: 12 testers durante 14 dias en prueba cerrada antes de Production | Google | Cuenta de organizacion (D-U-N-S), o planificar la prueba cerrada |
| R8 | Distribucion en la UE sin declaracion de comerciante (DSA) | Apple | Limitar la disponibilidad a Estados Unidos o declarar |
| R9 | Elegir una build de Sandbox (1.0.0 (1)/(2)) al enviar | Apple | Elegir solo la build `hdg-production` |

## 8. Orden de las builds de Production (cuando se autorice)

1. Backend Production: `PRIVACY_POLICY_URL__HDG` y la cuenta demo (R2, R3).
2. Decidir R1 (cuenta que publica) **antes** de nada en App Store Connect.
3. `npm run check:hdg-production` → `OK`.
4. iOS: `eas build -p ios --profile hdg-production`.
5. Verificar el IPA:
   - bundle id;
   - API `core`;
   - `aps-environment production`;
   - sin `sandbox-core`.
6. Subir a TestFlight y probar en un iPhone con la cuenta demo.
7. Android: `eas build -p android --profile hdg-production` (AAB).
8. Verificar el AAB:
   - package;
   - `targetSdk`;
   - permisos (sin `SYSTEM_ALERT_WINDOW`);
   - API `core`.
9. Subirlo **a mano** a la pista interna (primera version) y probar.
10. Capturas con esas builds y enviar a revision.

Los comandos estan en `docs/hdg-production-app-review.md` §3.

## 9. Configuracion manual en las consolas

**App Store Connect** (app `6835613644`):
- precio gratis, disponibilidad (R8);
- categoria;
- clasificacion por edad (cuestionario nuevo: sin contenido sensible);
- App Privacy (§3);
- URL de privacidad y de soporte;
- textos y capturas (§6);
- App Review Information: demo, contacto y notas;
- declaracion DSA si hay UE;
- respuesta de cifrado ya resuelta por el plist.

**Google Play Console:**
- crear la app (package, gratis, app no juego);
- Play App Signing;
- App access (demo);
- Ads: no;
- Content rating (IARC);
- Target audience 18+;
- Data Safety (§3);
- Financial features: ninguna;
- Government app: no;
- Health: no;
- URL de privacidad y de borrado (§5);
- ficha (§6), icono 512, grafico 1024x500;
- prueba interna, luego cerrada (R7) y Production;
- cuenta de servicio para `eas submit` (`docs/hdg-production-app-review.md` §3).

## 10. Checklist final

- [ ] R1 decidido (cuenta que publica)
- [ ] `PRIVACY_POLICY_URL__HDG` en Production; el enlace se ve en Login y en Settings
- [ ] Cuenta demo creada; login probado en iPhone y Android
- [ ] Pagina web de borrado de cuenta publicada
- [ ] Textos de §6 cotejados con lo que hace Production
- [ ] Builds `hdg-production` iOS y Android verificadas (bundle, API, permisos, push)
- [ ] Probadas en dispositivo fisico: login, buzon, detalle, escaneo, reenvio (sin pagar), avisos, Delete Account (sin enviar), Sign out
- [ ] Capturas e imagenes de ficha
- [ ] App Privacy y Data Safety revisados por quien responde legalmente
- [ ] Clasificacion por edad e IARC
- [ ] Notas de revision y credenciales en las consolas (nunca en Git)
- [ ] Prueba cerrada de Google completada si la cuenta la exige (R7)
- [ ] Enviar a revision (requiere autorizacion)
