/**
 * OAuth 2.0 authorization code flow with PKCE, for Wikimedia.
 * Pure protocol work: builds URLs, makes the code challenge, trades a code
 * for tokens. It never touches chrome.* or storage, so it runs under Node.
 *
 * The extension is a public client. It holds no client secret, because
 * anything shipped in an extension is readable. PKCE replaces the secret:
 * the verifier stays in memory and proves the code came from this client.
 */

/** Where the user approves the request, and where tokens are traded. */
const AUTHORIZE_URL = 'https://www.wikidata.org/w/rest.php/oauth2/authorize';
const TOKEN_URL = 'https://www.wikidata.org/w/rest.php/oauth2/access_token';

/** Who the signed-in user is. An incomplete OpenID Connect UserInfo. */
const PROFILE_URL = 'https://www.wikidata.org/w/rest.php/oauth2/resource/profile';

/** The maximum wait for a token or profile request. */
const TIMEOUT_MS = 15000;

/**
 * Seconds of headroom before a token counts as expired. A token that expires
 * during a request would fail the edit, so it is refreshed early.
 */
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
 * The verifier is a random string; the challenge is its SHA-256, so the
 * authorization server never sees the verifier until the trade.
 *
 * @returns {Promise<{verifier: string, challenge: string}>}
 */
export async function createPkcePair() {
  const verifier = randomUrlSafe(64);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

/**
 * Build the address where the user approves the request.
 *
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
 * Read the authorization code out of the address the browser came back to.
 * The state must match the one sent, or the answer is not ours.
 *
 * @param {string} redirectUrl
 * @param {string} expectedState
 * @returns {string} the authorization code
 */
export function readCallback(redirectUrl, expectedState) {
  const url = new URL(redirectUrl);
  // The parameters can arrive in the query or the fragment.
  const params = new URLSearchParams(url.search || url.hash.replace(/^#/, ''));

  const error = params.get('error');
  if (error) {
    throw authError(params.get('error_description') || describeError(error), error);
  }

  const state = params.get('state');
  if (state !== expectedState) {
    // A mismatch means the answer belongs to a different request.
    throw authError('The sign-in answer did not match the request.', 'state-mismatch');
  }

  const code = params.get('code');
  if (!code) throw authError('The sign-in answer carried no code.', 'no-code');

  return code;
}

/**
 * Trade an authorization code for tokens.
 *
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
 * Trade a refresh token for a new access token. Wikimedia expires an access
 * token after about four hours, so a long session refreshes several times.
 *
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
 * Ask who the token belongs to.
 *
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
    throw authError('The sign-in has expired. Sign in again.', 'unauthorized');
  }
  if (!res.ok) throw authError(`Wikidata returned ${res.status}.`, 'profile-failed');

  const data = await res.json();
  return {
    username: data.username ?? '',
    sub: String(data.sub ?? ''),
    blocked: Boolean(data.blocked),
    rights: Array.isArray(data.rights) ? data.rights : [],
  };
}

/**
 * True when a token set is missing, or close enough to expiry to refresh.
 *
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
 * POST to the token endpoint and read the answer into a TokenSet.
 *
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
    throw authError(`Could not reach Wikidata. ${cause.message}`, 'network');
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw authError(`Wikidata returned ${res.status} with no readable answer.`, 'token-failed');
  }

  if (!res.ok || data.error) {
    // invalid_grant means the refresh token is spent or withdrawn. The
    // caller signs the user out, because no retry can fix it.
    const code = data.error === 'invalid_grant' ? 'invalid-grant' : 'token-failed';
    throw authError(
      data.error_description || data.error || `Wikidata returned ${res.status}.`,
      code,
    );
  }

  if (!data.access_token) throw authError('Wikidata returned no access token.', 'token-failed');

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    // expires_in is seconds from now. Storing the moment avoids keeping a
    // countdown across a service worker that stops and starts.
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
      throw authError('Wikidata did not answer in time.', 'timeout');
    }
    throw cause;
  } finally {
    clearTimeout(t);
  }
}

/** A plain-language message for an OAuth error code. */
function describeError(code) {
  if (code === 'access_denied') return 'The sign-in was declined.';
  return `The sign-in failed (${code}).`;
}

/**
 * An error carrying a code, so a caller can act on the kind.
 * @param {string} message
 * @param {string} code
 */
function authError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** A random URL-safe string of the given length. */
function randomUrlSafe(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64Url(bytes).slice(0, length);
}

/** Base64url, as PKCE and JWT use: no padding, and two characters swapped. */
function base64Url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
