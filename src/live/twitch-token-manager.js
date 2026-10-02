/** Validate and rotate the account-scoped token used by the station Twitch IRC session. */

export const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
export const TWITCH_TOKEN_VALIDATE_URL = "https://id.twitch.tv/oauth2/validate";
export const TWITCH_IRC_REQUIRED_SCOPES = Object.freeze(["chat:read", "chat:edit"]);

const REFRESH_BEFORE_SECONDS = 15 * 60;
const RETRY_SECONDS = 30;
const VALIDATE_EVERY_SECONDS = 60 * 60;

export class TwitchTokenError extends Error {
  constructor(code) {
    super(code);
    this.name = "TwitchTokenError";
    this.code = code;
  }
}

function authError(code) {
  return new TwitchTokenError(code);
}

function accessToken(value) {
  const token = String(value ?? "").trim().replace(/^oauth:/i, "");
  if (!token || /[\s\r\n]/.test(token)) throw authError("twitch_token_invalid");
  return token;
}

function refreshToken(value) {
  const token = String(value ?? "").trim();
  if (!token || /[\s\r\n]/.test(token)) throw authError("twitch_refresh_not_configured");
  return token;
}

function clientId(value) {
  const id = String(value ?? "").trim();
  if (!/^[a-z0-9]+$/i.test(id)) throw authError("twitch_client_not_configured");
  return id;
}

function expectedLogin(value) {
  const login = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9_]{4,25}$/.test(login)) throw authError("twitch_login_invalid");
  return login;
}

function codeFor(error, fallback) {
  return error instanceof TwitchTokenError ? error.code : fallback;
}

async function json(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export async function validateTwitchUserToken({
  accessToken: tokenInput,
  login,
  fetchImpl = globalThis.fetch,
  clock = Date.now,
}) {
  const token = accessToken(tokenInput);
  const requiredLogin = expectedLogin(login);
  let response;
  try {
    response = await fetchImpl(TWITCH_TOKEN_VALIDATE_URL, {
      headers: { Authorization: `OAuth ${token}` },
    });
  } catch {
    throw authError("twitch_validate_unavailable");
  }
  if (!response?.ok) {
    throw authError(response?.status === 401
      ? "twitch_token_invalid"
      : "twitch_validate_unavailable");
  }

  const payload = await json(response);
  if (String(payload.login ?? "").toLowerCase() !== requiredLogin) {
    throw authError("twitch_login_mismatch");
  }
  const scopes = Array.isArray(payload.scopes) ? payload.scopes : [];
  if (TWITCH_IRC_REQUIRED_SCOPES.some((scope) => !scopes.includes(scope))) {
    throw authError("twitch_scope_missing");
  }
  const expiresIn = Number(payload.expires_in);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw authError("twitch_token_invalid");
  }
  return Object.freeze({
    login: requiredLogin,
    scopes: Object.freeze([...scopes]),
    expires_in: expiresIn,
    expires_at: new Date(clock() + expiresIn * 1000).toISOString(),
  });
}

export async function refreshTwitchUserToken({
  clientId: clientInput,
  refreshToken: refreshInput,
  fetchImpl = globalThis.fetch,
}) {
  const client = clientId(clientInput);
  const currentRefresh = refreshToken(refreshInput);
  let response;
  try {
    response = await fetchImpl(TWITCH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: client,
        refresh_token: currentRefresh,
        grant_type: "refresh_token",
      }),
    });
  } catch {
    throw authError("twitch_refresh_unavailable");
  }
  if (!response?.ok) {
    throw authError(response?.status >= 500 || response?.status === 429
      ? "twitch_refresh_unavailable"
      : "twitch_refresh_rejected");
  }

  const payload = await json(response);
  return Object.freeze({
    accessToken: accessToken(payload.access_token),
    refreshToken: refreshToken(payload.refresh_token ?? currentRefresh),
  });
}

export function createTwitchTokenManager({
  clientId: clientInput,
  accessToken: accessInput,
  refreshToken: refreshInput,
  login,
  onToken,
  onTokens = async () => {},
  onState = () => {},
  fetchImpl = globalThis.fetch,
  clock = Date.now,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (timer) => clearTimeout(timer),
  refreshBeforeSeconds = REFRESH_BEFORE_SECONDS,
  retrySeconds = RETRY_SECONDS,
  validateEverySeconds = VALIDATE_EVERY_SECONDS,
}) {
  if (typeof onToken !== "function") throw new TypeError("onToken must be a function");
  if (typeof onTokens !== "function") throw new TypeError("onTokens must be a function");
  if (typeof onState !== "function") throw new TypeError("onState must be a function");

  const client = clientId(clientInput);
  const requiredLogin = expectedLogin(login);
  let currentAccess = accessToken(accessInput);
  let currentRefresh = refreshToken(refreshInput);
  let active = false;
  let timer = null;
  let validation = null;
  let lastError = null;
  let persistencePending = false;

  const state = () => Object.freeze({
    enabled: active,
    validated: Boolean(validation),
    login: validation?.login ?? null,
    expires_at: validation?.expires_at ?? null,
    maintenance_scheduled: Boolean(timer),
    persistence_pending: persistencePending,
    last_error: lastError,
  });
  const emitState = () => {
    try {
      onState(state());
    } catch {
      // Auth health observers must never interrupt token rotation.
    }
  };
  const clearTimer = () => {
    if (timer) cancel(timer);
    timer = null;
  };
  const arm = (task, delayMs) => {
    if (!active) return;
    clearTimer();
    timer = schedule(() => {
      timer = null;
      void task();
    }, Math.max(1_000, delayMs));
    emitState();
  };
  const fail = (error, retryTask = null) => {
    lastError = codeFor(error, "twitch_auth_failed");
    emitState();
    if (retryTask) arm(retryTask, retrySeconds * 1000);
  };
  const scheduleMaintenance = (overrideMs = null) => {
    const expiresAt = Date.parse(validation.expires_at);
    const refreshDelayMs = expiresAt - clock() - refreshBeforeSeconds * 1000;
    const validationDelayMs = validateEverySeconds * 1000;
    const delayMs = overrideMs ?? Math.min(refreshDelayMs, validationDelayMs);
    arm(maintain, delayMs);
  };
  const activate = async (token, nextValidation, storeError = null) => {
    if (!active) return;
    validation = nextValidation;
    lastError = storeError;
    try {
      await onToken(token, nextValidation);
    } catch {
      lastError = "irc_start_failed";
    }
    emitState();
    scheduleMaintenance(storeError ? retrySeconds * 1000 : null);
  };
  const persistCurrent = async () => {
    try {
      await onTokens({
        accessToken: currentAccess,
        refreshToken: currentRefresh,
        validation,
      });
      persistencePending = false;
      return null;
    } catch {
      persistencePending = true;
      return "twitch_token_store_failed";
    }
  };
  const finishRotation = async (storeError = null) => {
    if (!active) return state();
    try {
      const nextValidation = await validateTwitchUserToken({
        accessToken: currentAccess,
        login: requiredLogin,
        fetchImpl,
        clock,
      });
      if (!active) return state();
      await activate(currentAccess, nextValidation, storeError);
    } catch (error) {
      const code = codeFor(error, "twitch_auth_failed");
      const retry = code === "twitch_validate_unavailable";
      fail(error, retry ? () => finishRotation(storeError) : null);
    }
    return state();
  };
  const rotate = async () => {
    if (!active) return state();
    try {
      const next = await refreshTwitchUserToken({
        clientId: client,
        refreshToken: currentRefresh,
        fetchImpl,
      });
      currentAccess = next.accessToken;
      currentRefresh = next.refreshToken;
      validation = null;
      persistencePending = true;
      // A successful refresh invalidates the old rotating credential. Persist
      // the new pair before validation so shutdown or a validation outage
      // cannot strand the secrets manager with an already-consumed refresh token.
      const storeError = await persistCurrent();
      if (!active) return state();
      return finishRotation(storeError);
    } catch (error) {
      const code = codeFor(error, "twitch_auth_failed");
      const retry = code === "twitch_refresh_unavailable";
      fail(error, retry ? rotate : null);
    }
    return state();
  };
  const maintain = async () => {
    if (!active) return state();
    try {
      const currentValidation = await validateTwitchUserToken({
        accessToken: currentAccess,
        login: requiredLogin,
        fetchImpl,
        clock,
      });
      if (!active) return state();
      validation = currentValidation;
      if (currentValidation.expires_in <= refreshBeforeSeconds) return rotate();
      const storeError = persistencePending ? await persistCurrent() : null;
      lastError = storeError;
      emitState();
      scheduleMaintenance(storeError ? retrySeconds * 1000 : null);
    } catch (error) {
      const code = codeFor(error, "twitch_auth_failed");
      if (code === "twitch_token_invalid") return rotate();
      fail(error, code === "twitch_validate_unavailable" ? maintain : null);
    }
    return state();
  };
  const bootstrap = async () => {
    try {
      const currentValidation = await validateTwitchUserToken({
        accessToken: currentAccess,
        login: requiredLogin,
        fetchImpl,
        clock,
      });
      if (!active) return state();
      if (currentValidation.expires_in <= refreshBeforeSeconds) return rotate();
      await activate(currentAccess, currentValidation);
    } catch (error) {
      const code = codeFor(error, "twitch_auth_failed");
      if (code === "twitch_token_invalid") return rotate();
      fail(error, code === "twitch_validate_unavailable" ? bootstrap : null);
    }
    return state();
  };
  const start = async () => {
    if (active) return state();
    active = true;
    lastError = null;
    emitState();
    return bootstrap();
  };
  const stop = () => {
    active = false;
    clearTimer();
    emitState();
    return state();
  };

  return Object.freeze({ start, stop, state });
}
