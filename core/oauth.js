/**
 * Run the OAuth 2.0 authorization code flow with PKCE for Wikimedia.
 * This module does not use chrome.* or storage, so it runs in Node.
 */

/** The approval page and the token endpoint. */
const AUTHORIZE_URL = 'https://www.wikidata.org/w/rest.php/oauth2/authorize';
const TOKEN_URL = 'https://www.wikidata.org/w/rest.php/oauth2/access_token';

/** The profile of the signed-in user. It is a partial OpenID Connect UserInfo. */
const PROFILE_URL = 'https://www.wikidata.org/w/rest.php/oauth2/resource/profile';

/** The maximum wait for a token or profile request. */
const TIMEOUT_MS = 15000;

/** Refresh a token this number of seconds before it expires. */
const EXPIRY_SKEW_S = 120;

/**
 * @typedef {{
 *   accessToken: string,
 *   refreshToken?: string,
 *   expiresAt: number
 * }} TokenSet
 */

/**
 * Make a PKCE verifier and its challenge.
 * The challenge is the SHA-256 of the verifier.
 * @returns {Promise<{verifier: string, challenge: string}>}
 */
export async function createPkcePair() {
  const verifier = randomUrlSafe(64);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

/**
 * Make the address of the approval page.
 * @param {{clientId: string, redirectUri: string, challenge: string, state: string}} opts
 * @returns {string}
 */
export function authorizeUrl({ clientId, redirectUri, challenge, state }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${AUTHORIZE_URL}?${params}`;
}

/**
 * Get the authorization code from the redirect address.
 * The state must be the same as the state in the request.
 * @param {string} redirectUrl
 * @param {string} expectedState
 * @returns {string} the authorization code
 */
export function readCallback(redirectUrl, expectedState) {
  const url = new URL(redirectUrl);
  // The parameters can be in the query or in the fragment.
  const params = new URLSearchParams(url.search || url.hash.replace(/^#/, ''));

  const error = params.get('error');
  if (error) {
    throw authError(params.get('error_description') || describeError(error), error);
  }

  const state = params.get('state');
  if (state !== expectedState) {
    // A different state means that the answer is for a different request.
    throw authError('The sign-in answer is not for this request.', 'state-mismatch');
  }

  const code = params.get('code');
  if (!code) throw authError('The sign-in answer has no code.', 'no-code');

  return code;
}

/**
 * Exchange an authorization code for tokens.
 * @param {{clientId: string, code: string, verifier: string, redirectUri: string}} opts
 * @returns {Promise<TokenSet>}
 */
export async function exchangeCode({ clientId, code, verifier, redirectUri }) {
  return tokenRequest({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    code_verifier: verifier,
    code_challenge_method: 'S256',
    redirect_uri: redirectUri,
  });
}

/**
 * Exchange a refresh token for a new access token.
 * An access token from Wikimedia expires after approximately four hours.
 * @param {{clientId: string, refreshToken: string}} opts
 * @returns {Promise<TokenSet>}
 */
export async function refreshTokens({ clientId, refreshToken }) {
  return tokenRequest({
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
  });
}

/**
 * Get the account that owns the token.
 * @param {string} accessToken
 * @param {string} userAgent
 * @returns {Promise<{username: string, sub: string, blocked: boolean, rights: string[]}>}
 */
export async function fetchProfile(accessToken, userAgent) {
  const res = await withTimeout((signal) =>
    fetch(PROFILE_URL, {
      signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'Api-User-Agent': userAgent,
      },
    }),
  );

  if (res.status === 401 || res.status === 403) {
    throw authError('Your sign-in is expired. Sign in again.', 'unauthorized');
  }
  if (!res.ok) throw authError(`Wikidata sent error ${res.status}.`, 'profile-failed');

  const data = await res.json();
  return {
    username: data.username ?? '',
    sub: String(data.sub ?? ''),
    blocked: Boolean(data.blocked),
    rights: Array.isArray(data.rights) ? data.rights : [],
  };
}

/**
 * Return true if the token set is missing or is almost expired.
 * @param {TokenSet | undefined} tokens
 * @param {number} [now] milliseconds, for the tests
 * @returns {boolean}
 */
export function isExpired(tokens, now = Date.now()) {
  if (!tokens?.accessToken) return true;
  if (!Number.isFinite(tokens.expiresAt)) return true;
  return now >= tokens.expiresAt - EXPIRY_SKEW_S * 1000;
}

/**
 * Send a POST to the token endpoint and read the answer into a TokenSet.
 * @param {Record<string, string>} body
 * @returns {Promise<TokenSet>}
 */
async function tokenRequest(body) {
  let res;
  try {
    res = await withTimeout((signal) =>
      fetch(TOKEN_URL, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams(body),
      }),
    );
  } catch (cause) {
    if (cause?.code) throw cause;
    throw authError(`Cannot connect to Wikidata. ${cause.message}`, 'network');
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw authError(`Wikidata sent error ${res.status} with no usable answer.`, 'token-failed');
  }

  if (!res.ok || data.error) {
    // invalid_grant means that the refresh token is used or withdrawn.
    const code = data.error === 'invalid_grant' ? 'invalid-grant' : 'token-failed';
    throw authError(
      data.error_description || data.error || `Wikidata sent error ${res.status}.`,
      code,
    );
  }

  if (!data.access_token) throw authError('Wikidata did not send an access token.', 'token-failed');

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    // Store the expiry time, because the service worker can stop and start.
    expiresAt: Date.now() + Number(data.expires_in ?? 14400) * 1000,
  };
}

/**
 * Run a fetch with a time limit.
 * @param {(signal: AbortSignal) => Promise<Response>} run
 */
async function withTimeout(run) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await run(ctl.signal);
  } catch (cause) {
    if (cause?.name === 'AbortError') {
      throw authError('Wikidata did not answer in the time limit.', 'timeout');
    }
    throw cause;
  } finally {
    clearTimeout(t);
  }
}

/** Get a message for the user from an OAuth error code. */
function describeError(code) {
  if (code === 'access_denied') return 'You declined the sign-in.';
  return `The sign-in failed (${code}).`;
}

/**
 * Make an error with a code, so that the caller can identify the type.
 * @param {string} message
 * @param {string} code
 */
function authError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** Make a random URL-safe string of the given length. */
function randomUrlSafe(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64Url(bytes).slice(0, length);
}

/** Encode as base64url, with no padding. PKCE and JWT use this encoding. */
function base64Url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
