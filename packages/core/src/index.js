export { createApiClient, createApiProbe, isPublicAuthRequest, PROBE_PATH } from "./api.js";

export {
  AVAILABILITY_OFFLINE,
  AVAILABILITY_TIMEOUT,
  AVAILABILITY_UNAVAILABLE,
  classifyAvailability,
  DEFAULT_TIMEOUT_MS,
  isBackendErrorBody,
  isCancellation,
  isHealthyResponse,
  isReachableResponse,
  isTimeoutError,
} from "./availability.js";

export {
  AUTH_USER_UPDATED_EVENT,
  broadcastAuthUserUpdated,
  getCurrentCenter,
  getCurrentCenterId,
  getCurrentCenterName,
  normalizeAuthUser,
} from "./auth.js";

export { emit, on } from "./events.js";

export {
  classifySessionError,
  isRefreshRejection,
  SESSION_FORBIDDEN,
  SESSION_INVALID,
  SESSION_TEMPORARY,
} from "./session.js";

export {
  clearAuthUser,
  clearTokens,
  configureStorage,
  getAuthUser,
  getJsonValue,
  getTokens,
  setAuthUser,
  setJsonValue,
  setTokens,
} from "./storage.js";

export { formatDate, formatErrorMessage } from "./utils.js";
