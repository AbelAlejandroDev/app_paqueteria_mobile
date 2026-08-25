import { emit } from "./events.js";

export const AUTH_USER_UPDATED_EVENT = "auth:user-updated";

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function getCurrentCenter(user) {
  if (!user || typeof user !== "object") return null;

  return user.staffProfile?.center || user.center || user.location || user.branch || null;
}

export function getCurrentCenterId(user) {
  if (!user || typeof user !== "object") return null;

  const centerId = normalizeString(
    user.staffProfile?.centerId ||
      user.staffProfile?.center?.id ||
      user.centerId ||
      user.center?.id ||
      user.locationId ||
      user.location?.id ||
      user.branchId ||
      user.branch?.id ||
      ""
  );

  return centerId || null;
}

export function getCurrentCenterName(user) {
  if (!user || typeof user !== "object") return null;

  const centerName = normalizeString(
    user.staffProfile?.center?.name ||
      user.centerName ||
      user.center?.name ||
      user.locationName ||
      user.location?.name ||
      user.branchName ||
      user.branch?.name ||
      ""
  );

  return centerName || null;
}

export function normalizeAuthUser(user, payload = {}) {
  if (!user || typeof user !== "object") return null;

  const payloadUser = payload?.user && typeof payload.user === "object" ? payload.user : null;
  const staffProfile =
    user.staffProfile ||
    payloadUser?.staffProfile ||
    (payload?.staffProfile && typeof payload.staffProfile === "object" ? payload.staffProfile : null) ||
    null;

  const mergedUser = {
    ...user,
    ...(staffProfile ? { staffProfile } : {}),
  };

  const center = getCurrentCenter(mergedUser) || getCurrentCenter(payloadUser) || getCurrentCenter(payload) || null;
  const centerId = getCurrentCenterId(mergedUser) || getCurrentCenterId(payloadUser) || getCurrentCenterId(payload) || "";
  const centerName = getCurrentCenterName(mergedUser) || getCurrentCenterName(payloadUser) || getCurrentCenterName(payload) || "";

  return {
    ...mergedUser,
    staffProfile: staffProfile
      ? {
          ...staffProfile,
          ...(center ? { center } : {}),
        }
      : null,
    center: center || undefined,
    centerId,
    centerName,
  };
}

export function broadcastAuthUserUpdated(user) {
  emit(AUTH_USER_UPDATED_EVENT, user ?? null);
}
