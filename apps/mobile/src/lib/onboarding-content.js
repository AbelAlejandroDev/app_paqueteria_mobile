/**
 * Textos del tutorial de bienvenida, segun el plan del cliente.
 *
 * Cada regla esta comprobada contra el backend (auditoria de origin/main,
 * 1332dc0). Lo que el negocio aun no ha cerrado no se cuenta con cifras: el
 * precio de escaneo y de reenvio del plan Basic no coincide entre la app y el
 * Fee Schedule publicado, asi que aqui solo se dice que tienen coste y que el
 * cliente lo ve antes de confirmar. Nada de esto calcula precios: solo explica.
 *
 * Sin React, para poder probar que cada plan recibe lo suyo.
 */

export const PLANS = { BASIC: "BASIC", PREMIUM: "PREMIUM" };

/** El plan que da /auth/me (Mailbox.servicePlan). Sin dato, el de pago por uso. */
export function planOf(user) {
  return String(user?.clientContext?.servicePlan || "").toUpperCase() === PLANS.PREMIUM
    ? PLANS.PREMIUM
    : PLANS.BASIC;
}

/**
 * Almacenaje de paquetes (storageFees.js): 3 dias habiles gratis desde el dia
 * habil siguiente a la recepcion, contando los dias que abre el centro; los
 * festivos NO se excluyen, asi que no se mencionan. El cargo no es automatico
 * (lo aplica el centro y puede rebajarlo): de ahi "may apply". Igual en los
 * dos planes. El importe no se escribe aqui: el paquete lo muestra antes.
 */
export const PACKAGE_STORAGE_TEXT =
  "Packages are held free for 3 business days after we receive them. After that, a storage fee may apply for each business day until the package is picked up, forwarded, or discarded.";

const STORAGE_WARNING_TEXT =
  "Before the free period ends, we'll warn you on the package and with a notification.";

/** Tarjetas de "Good to Know". `tone: "warning"` solo para el plazo de almacenaje. */
export function goodToKnowCards(plan) {
  const premium = plan === PLANS.PREMIUM;

  return [
    {
      key: "storage",
      icon: "package",
      tone: "warning",
      title: "Package Storage",
      body: "Packages are held free for 3 business days. After that, a daily storage fee may apply.",
    },
    {
      key: "pickup",
      icon: "pickup",
      title: "Package Pickup",
      body: "Request a pickup in the app. We'll let you know when it's ready. Bring a photo ID.",
    },
    premium
      ? {
          key: "scan",
          icon: "scan",
          title: "Mail Scanning",
          body: "New letters are scanned automatically. Your plan includes pages each billing cycle; extra pages are charged.",
        }
      : {
          key: "scan",
          icon: "scan",
          title: "Mail Scanning",
          body: "Scanning is a paid service on your plan. You'll see the price before you confirm.",
        },
    premium
      ? {
          key: "forward",
          icon: "forward",
          title: "Mail Forwarding",
          body: "Your mail is forwarded once a month with your plan. Postage and handling still apply.",
        }
      : {
          key: "forward",
          icon: "forward",
          title: "Mail Forwarding",
          body: "Request forwarding whenever you need it. Postage and handling charges apply.",
        },
    {
      key: "billing",
      icon: "billing",
      title: "Billing",
      body: "Your membership and service charges appear in Billing. Past-due accounts can't request new services.",
    },
  ];
}

/**
 * Pantallas de bienvenida. `brandName` es el nombre de la app de la marca
 * ("My Worx Mail"), nunca fijo: otra organizacion ve el suyo.
 */
export function buildWelcomeSlides({ plan, brandName = "" } = {}) {
  return [
    {
      key: "welcome",
      kind: "welcome",
      title: brandName ? `Welcome to ${brandName}` : "Welcome",
      description: "Your virtual office, mail, and packages — all in one place.",
    },
    {
      key: "mailbox",
      kind: "mailbox",
      title: "Your Digital Mailbox",
      description: "View your letters and packages as soon as they're received.",
    },
    {
      key: "control",
      kind: "control",
      title: "You're in Control",
      description: "Request pickup, scanning, or forwarding whenever available.",
    },
    {
      key: "good-to-know",
      kind: "goodToKnow",
      title: "Good to Know",
      description: plan === PLANS.PREMIUM ? "A few things about your Premium plan." : "A few things about your plan.",
      cards: goodToKnowCards(plan),
    },
    {
      key: "updates",
      kind: "updates",
      title: "Never Miss an Update",
      description: "Get notified about new mail, requests, and deliveries.",
      cta: "Explore the App",
    },
  ];
}

/**
 * Pasos del recorrido sobre la app real. `anchor` es el TourAnchor que se
 * resalta; sin anchor, el paso es ilustrativo (no navega a ninguna pieza: el
 * cliente puede no tener correo todavia, y abrir una suya seria entrar en
 * datos privados sin que lo pida).
 */
export function buildTourSteps({ plan } = {}) {
  const premium = plan === PLANS.PREMIUM;

  return [
    {
      key: "dashboard",
      anchor: "home-overview",
      title: "Your Dashboard",
      description: "This is your overview of mail, updates, and available services.",
      note: "Your mailbox number and your center's address are shown here.",
    },
    {
      key: "mail",
      anchor: "tab-mail",
      title: "Your Mailbox",
      description: "Find your letters and packages here, sorted into Inbox, Pending, Action Required, and Completed.",
    },
    {
      key: "item",
      anchor: null,
      illustration: "itemActions",
      title: "Manage Each Item",
      description: "Open a mail item to view its photo, details, and available actions.",
      note: premium
        ? "Letters are scanned automatically on your plan. Extra pages and forwarding postage are charged."
        : "Scanning and forwarding are paid services on your plan. You'll see the charges before you confirm.",
    },
    {
      key: "storage",
      anchor: null,
      illustration: "packageStorage",
      tone: "warning",
      title: "Package Storage",
      description: PACKAGE_STORAGE_TEXT,
      note: STORAGE_WARNING_TEXT,
    },
    {
      key: "billing",
      anchor: "tab-billing",
      title: "Billing & Payments",
      description: "Review your billing information and payment history.",
      note: "Service charges go to the card on file and show up here.",
    },
    {
      key: "notifications",
      anchor: "notifications-bell",
      title: "Stay Connected",
      description: "Check notifications for updates on new mail, scans, shipments, and anything that needs your attention.",
    },
    {
      key: "help",
      anchor: "tab-help",
      title: "We're Here to Help",
      description: "Visit Help whenever you need assistance. Your center's contact details are there.",
    },
  ];
}
