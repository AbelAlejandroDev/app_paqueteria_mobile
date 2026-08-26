export const DEFAULT_BASIC_PLAN_SERVICE_NOTICES = {
  scan: {
    title: "Scan service fee",
    message:
      "Your Basic plan does not include complimentary scanning. Scan requests are billed at $5.00 for up to 10 pages, plus {{fee}} for each additional page.",
    confirmLabel: "Continue to scan request",
    extraPageFeeCents: 50,
  },
  forward: {
    title: "Forwarding service fee",
    message:
      "Your Basic plan does not include complimentary forwarding. Postage, shipping, handling, and applicable service fees will be quoted for approval before dispatch.",
    confirmLabel: "Continue to forward request",
  },
};

function normalizeNotice(source, fallback) {
  return {
    title: source?.title || fallback.title,
    message: source?.message || fallback.message,
    confirmLabel: source?.confirmLabel || fallback.confirmLabel,
    ...(Number.isInteger(fallback.extraPageFeeCents)
      ? {
          extraPageFeeCents: Number.isInteger(source?.extraPageFeeCents)
            ? source.extraPageFeeCents
            : fallback.extraPageFeeCents,
        }
      : {}),
  };
}

export function formatServiceNoticeMessage(notice) {
  const feeCents = Number.isInteger(notice?.extraPageFeeCents) ? notice.extraPageFeeCents : 50;
  const formattedFee = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(feeCents / 100);

  return String(notice?.message || "").replaceAll("{{fee}}", formattedFee);
}

export function normalizeBasicPlanServiceNotices(value) {
  return {
    scan: normalizeNotice(value?.scan, DEFAULT_BASIC_PLAN_SERVICE_NOTICES.scan),
    forward: normalizeNotice(value?.forward, DEFAULT_BASIC_PLAN_SERVICE_NOTICES.forward),
  };
}
