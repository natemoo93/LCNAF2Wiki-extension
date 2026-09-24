/**
 * The signed-in session: the browser half of OAuth.
 * core/oauth.js speaks the protocol; this module runs the flow in a browser
 * extension, keeps the tokens and gives the rest of the app one question to
 * ask, getAccessToken().
 *
 * Tokens live in chrome.storage.local, never in sync. A sync store copies
 * itself to every signed-in browser, and a credential must not travel.
 */

import {
  authorizeUrl,
  createPkcePair,
  exchangeCode,
  fetchProfile,
  isExpired,
  readCallback,
  refreshTokens,
} from './oauth.js';
import { USER_AGENT } from './wikidata.js';

/** Where the tokens and the account sit in chrome.storage.local. */
const TOKEN_KEY = 'oauthTokens';
const ACCOUNT_KEY = 'oauthAccount';

/** Where a client is registered. Only the advanced setting shows this. */
export const REGISTER_URL =
  'https://meta.wikimedia.org/wiki/Special:OAuthConsumerRegistration/propose/oauth2';

/**
 * The registered OAuth client of this extension.
 *
 * This is public, and it is meant to be. A public client holds no secret,
 * because anything shipped in an extension can be read out of it. PKCE is
 * what proves a request, not a secret. Every installation shares this id and
 * each user still signs in to their own account and gets their own token.
 *
 * TODO: replace with the Northwestern institutional client once registered.
 */
const DEFAULT_CLIENT_ID = '';

/** An override, for a different client. Empty for nearly every user. */
const CLIENT_ID_KEY = 'oauthClientId';

/**
 * @typedef {{username: string, sub: string, blocked: boolean, rights: string[]}} Account
 * @typedef {{state: 'in', account: Account} | {state: 'out'} | {state: 'unconfigured'}} SessionState
 */

/**
 * One refresh at a time. Two popups opening together would otherwise each
 * spend the refresh token, and the second would fail with invalid_grant.
 * @type {Promise<string> | null}
 */
let refreshing = null;

/**
 * Who is signed in, if anyone.
 * 'unconfigured' means this build carries no client id and none is stored,
 * which only happens in a source tree where the constant is still empty.
 *
 * @returns {Promise<SessionState>}
 */
export async function getSession() {
  const clientId = await getClientId();
  if (!clientId) return { state: 'unconfigured' };

  const account = await readLocal(ACCOUNT_KEY);
  const tokens = await readLocal(TOKEN_KEY);

  // An account with no refresh token cannot outlive its access token.
  if (!account?.username || !tokens?.accessToken) return { state: 'out' };

  return { state: 'in', account };
}

/**
 * Run the sign-in. Opens the Wikimedia approval page in a browser window the
 * extension does not control, so the password is never seen by this code.
 *
 * @returns {Promise<Account>}
 */
export async function signIn() {
  const clientId = await getClientId();
  if (!clientId) {
    throw authError(
      'This build carries no OAuth client id, so sign-in cannot run.',
      'unconfigured',
    );
  }

  const redirectUri = getRedirectUri();
  const { verifier, challenge } = await createPkcePair();
  // The state ties the answer to this request, against a forged callback.
  const state = crypto.randomUUID();

  const url = authorizeUrl({ clientId, redirectUri, challenge, state });

  const redirectUrl = await launchWebAuthFlow(url);
  const code = readCallback(redirectUrl, state);

  const tokens = await exchangeCode({ clientId, code, verifier, redirectUri });
  const account = await fetchProfile(tokens.accessToken, USER_AGENT);

  await writeLocal(TOKEN_KEY, tokens);
  await writeLocal(ACCOUNT_KEY, account);

  return account;
}

/**
 * Forget the tokens and the account. The authorization still stands on
 * Wikimedia, so this is a sign-out on this computer, not a revocation.
 * The message says so, and the options page links to the grant list.
 *
 * @returns {Promise<void>}
 */
export async function signOut() {
  await removeLocal([TOKEN_KEY, ACCOUNT_KEY]);
}

/**
 * A usable access token, refreshed if it is near expiry.
 * Throws with the code 'signed-out' when there is nothing to refresh, so a
 * caller can send the user to the sign-in button.
 *
 * @returns {Promise<string>}
 */
export async function getAccessToken() {
  const tokens = await readLocal(TOKEN_KEY);

  if (!tokens?.accessToken) {
    throw authError('Not signed in to Wikidata.', 'signed-out');
  }

  if (!isExpired(tokens)) return tokens.accessToken;

  // Expired. Join the refresh already running, or start one.
  refreshing ??= runRefresh(tokens).finally(() => {
    refreshing = null;
  });

  return refreshing;
}

/**
 * Spend the refresh token for a new access token. A refusal is final, so the
 * session is cleared and the user signs in again.
 *
 * @param {import('./oauth.js').TokenSet} tokens
 * @returns {Promise<string>}
 */
async function runRefresh(tokens) {
  const clientId = await getClientId();

  if (!tokens.refreshToken || !clientId) {
    await signOut();
    throw authError('The sign-in has expired. Sign in again.', 'signed-out');
  }

  try {
    const next = await refreshTokens({ clientId, refreshToken: tokens.refreshToken });
    // Wikimedia can return a new refresh token. Keeping the old one would
    // sign the user out at the next refresh.
    await writeLocal(TOKEN_KEY, next);
    return next.accessToken;
  } catch (cause) {
    // A spent or withdrawn grant cannot be retried.
    if (cause.code === 'invalid-grant' || cause.code === 'unauthorized') {
      await signOut();
      throw authError('The sign-in has expired. Sign in again.', 'signed-out');
    }
    // A network failure leaves the tokens alone, so a later try can work.
    throw cause;
  }
}

/* ---------- the client id ---------- */

/**
 * The registered OAuth client id, or an empty string.
 * @returns {Promise<string>}
 */
export async function getClientId() {
  const stored = await readLocal(CLIENT_ID_KEY);
  const override = typeof stored === 'string' ? stored.trim() : '';
  // An override wins, so a different client needs no new build.
  return override || DEFAULT_CLIENT_ID;
}

/**
 * The client id built into this copy of the extension, ignoring any
 * override. The settings page shows this, so the two are distinguishable.
 *
 * @returns {string}
 */
export function getBuiltInClientId() {
  return DEFAULT_CLIENT_ID;
}

/**
 * Store the client id. Changing it invalidates the session, because the
 * tokens belong to the client that issued them.
 *
 * @param {string} value
 * @returns {Promise<void>}
 */
export async function setClientId(value) {
  const next = String(value ?? '').trim();
  const current = await getClientId();

  // An empty value clears the override and returns to the built-in client.
  if (next === current || (!next && current === DEFAULT_CLIENT_ID)) return;

  await writeLocal(CLIENT_ID_KEY, next);
  await signOut();
}

/* ---------- the browser ---------- */

/**
 * The address Wikimedia sends the browser back to. It is derived from the
 * extension id, so it cannot be claimed by a website.
 *
 * @returns {string}
 */
export function getRedirectUri() {
  const api = globalThis.chrome?.identity ?? globalThis.browser?.identity;
  if (api?.getRedirectURL) return api.getRedirectURL();
  throw authError('This browser has no identity API, so sign-in cannot run.', 'no-identity');
}

/**
 * Open the approval page and wait for the browser to come back.
 * Chrome takes a callback, Firefox returns a promise, so this covers both.
 *
 * @param {string} url
 * @returns {Promise<string>} the redirect address
 */
function launchWebAuthFlow(url) {
  const api = globalThis.chrome?.identity ?? globalThis.browser?.identity;
  if (!api?.launchWebAuthFlow) {
    throw authError('This browser has no identity API, so sign-in cannot run.', 'no-identity');
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const done = (redirectUrl) => {
      if (settled) return;
      settled = true;

      const failure = globalThis.chrome?.runtime?.lastError;
      if (failure) {
        // The user closing the window arrives here, not as an OAuth error.
        reject(authError(signInFailure(failure.message), 'cancelled'));
        return;
      }
      if (!redirectUrl) {
        reject(authError('The sign-in window closed before it finished.', 'cancelled'));
        return;
      }
      resolve(redirectUrl);
    };

    try {
      const maybe = api.launchWebAuthFlow({ url, interactive: true }, done);
      // Firefox ignores the callback and returns a promise.
      if (maybe?.then) maybe.then(done, (cause) => {
        if (settled) return;
        settled = true;
        reject(authError(signInFailure(cause?.message), 'cancelled'));
      });
    } catch (cause) {
      reject(authError(signInFailure(cause?.message), 'cancelled'));
    }
  });
}

/** Turn a browser message into one a cataloguer can act on. */
function signInFailure(message) {
  const text = String(message ?? '');
  if (/cancel|closed|did not approve/i.test(text)) return 'The sign-in was cancelled.';
  return text ? `The sign-in did not finish. ${text}` : 'The sign-in did not finish.';
}

/* ---------- storage ---------- */

/** True when the local extension store is available. */
function hasLocal() {
  return Boolean(globalThis.chrome?.storage?.local);
}

async function readLocal(key) {
  if (!hasLocal()) return undefined;
  try {
    const got = await chrome.storage.local.get(key);
    return got?.[key];
  } catch {
    // A storage failure reads as signed out, which fails safe.
    return undefined;
  }
}

async function writeLocal(key, value) {
  if (!hasLocal()) return;
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch {
    // Nothing useful to do. The next read reports signed out.
  }
}

async function removeLocal(keys) {
  if (!hasLocal()) return;
  try {
    await chrome.storage.local.remove(keys);
  } catch {
    // As above.
  }
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
