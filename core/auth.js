/**
 * Manage the signed-in session in the browser. core/oauth.js holds the protocol.
 * Keep tokens in chrome.storage.local only, because sync copies them to other browsers.
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

/** Storage keys for the tokens and the account in chrome.storage.local. */
const TOKEN_KEY = 'oauthTokens';
const ACCOUNT_KEY = 'oauthAccount';

/** The page that registers a client. Only the advanced setting shows it. */
export const REGISTER_URL =
  'https://meta.wikimedia.org/wiki/Special:OAuthConsumerRegistration/propose/oauth2';

/**
 * The OAuth client ID of this extension. The ID is public and has no secret.
 * TODO: replace with the Northwestern institutional client when it is registered.
 */
const DEFAULT_CLIENT_ID = '';

/** Storage key for a different client ID. Most users leave it empty. */
const CLIENT_ID_KEY = 'oauthClientId';

/**
 * @typedef {{username: string, sub: string, blocked: boolean, rights: string[]}} Account
 * @typedef {{state: 'in', account: Account} | {state: 'out'} | {state: 'unconfigured'}} SessionState
 */

/**
 * The refresh that is in progress. Two popups must not use the same refresh token.
 * @type {Promise<string> | null}
 */
let refreshing = null;

/**
 * Get the session state. 'unconfigured' means that no client ID is available.
 * @returns {Promise<SessionState>}
 */
export async function getSession() {
  const clientId = await getClientId();
  if (!clientId) return { state: 'unconfigured' };

  const account = await readLocal(ACCOUNT_KEY);
  const tokens = await readLocal(TOKEN_KEY);

  // Without an access token, the account is not usable.
  if (!account?.username || !tokens?.accessToken) return { state: 'out' };

  return { state: 'in', account };
}

/**
 * Sign in through the Wikimedia approval page. This code does not see the password.
 * @returns {Promise<Account>}
 */
export async function signIn() {
  const clientId = await getClientId();
  if (!clientId) {
    throw authError(
      'This version has no OAuth client ID. You cannot sign in.',
      'unconfigured',
    );
  }

  const redirectUri = getRedirectUri();
  const { verifier, challenge } = await createPkcePair();
  // The state connects the answer to this request. It stops a forged callback.
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
 * Remove the tokens and the account from this computer.
 * The authorization on Wikimedia stays.
 * @returns {Promise<void>}
 */
export async function signOut() {
  await removeLocal([TOKEN_KEY, ACCOUNT_KEY]);
}

/**
 * Get an access token. Refresh it if it is almost expired.
 * Throw with the code 'signed-out' if no token is available.
 * @returns {Promise<string>}
 */
export async function getAccessToken() {
  const tokens = await readLocal(TOKEN_KEY);

  if (!tokens?.accessToken) {
    throw authError('You are not signed in to Wikidata.', 'signed-out');
  }

  if (!isExpired(tokens)) return tokens.accessToken;

  // The token is expired. Use the refresh in progress, or start a new one.
  refreshing ??= runRefresh(tokens).finally(() => {
    refreshing = null;
  });

  return refreshing;
}

/**
 * Get a new access token with the refresh token.
 * If Wikimedia refuses, clear the session.
 * @param {import('./oauth.js').TokenSet} tokens
 * @returns {Promise<string>}
 */
async function runRefresh(tokens) {
  const clientId = await getClientId();

  if (!tokens.refreshToken || !clientId) {
    await signOut();
    throw authError('Your sign-in is expired. Sign in again.', 'signed-out');
  }

  try {
    const next = await refreshTokens({ clientId, refreshToken: tokens.refreshToken });
    // Keep the new refresh token. The old token can be invalid now.
    await writeLocal(TOKEN_KEY, next);
    return next.accessToken;
  } catch (cause) {
    // Do not try again with a used or withdrawn grant.
    if (cause.code === 'invalid-grant' || cause.code === 'unauthorized') {
      await signOut();
      throw authError('Your sign-in is expired. Sign in again.', 'signed-out');
    }
    // Keep the tokens after a network failure. A later try can succeed.
    throw cause;
  }
}

/* ---------- the client ID ---------- */

/**
 * Get the OAuth client ID, or an empty string.
 * @returns {Promise<string>}
 */
export async function getClientId() {
  const stored = await readLocal(CLIENT_ID_KEY);
  const override = typeof stored === 'string' ? stored.trim() : '';
  // A stored ID replaces the built-in ID.
  return override || DEFAULT_CLIENT_ID;
}

/**
 * Get the built-in client ID. Ignore a stored ID.
 * @returns {string}
 */
export function getBuiltInClientId() {
  return DEFAULT_CLIENT_ID;
}

/**
 * Store the client ID. A change signs the user out, because tokens belong to one client.
 * @param {string} value
 * @returns {Promise<void>}
 */
export async function setClientId(value) {
  const next = String(value ?? '').trim();
  const current = await getClientId();

  // An empty value removes the stored ID and uses the built-in ID.
  if (next === current || (!next && current === DEFAULT_CLIENT_ID)) return;

  await writeLocal(CLIENT_ID_KEY, next);
  await signOut();
}

/* ---------- the browser ---------- */

/**
 * Get the return address for the sign-in.
 * The browser makes it from the extension ID, so a website cannot use it.
 * @returns {string}
 */
export function getRedirectUri() {
  const api = globalThis.chrome?.identity ?? globalThis.browser?.identity;
  if (api?.getRedirectURL) return api.getRedirectURL();
  throw authError('This browser has no identity API. You cannot sign in.', 'no-identity');
}

/**
 * Open the approval page and wait for the redirect.
 * Chrome uses a callback and Firefox uses a promise.
 * @param {string} url
 * @returns {Promise<string>} the redirect address
 */
function launchWebAuthFlow(url) {
  const api = globalThis.chrome?.identity ?? globalThis.browser?.identity;
  if (!api?.launchWebAuthFlow) {
    throw authError('This browser has no identity API. You cannot sign in.', 'no-identity');
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const done = (redirectUrl) => {
      if (settled) return;
      settled = true;

      const failure = globalThis.chrome?.runtime?.lastError;
      if (failure) {
        // A closed window comes here, not as an OAuth error.
        reject(authError(signInFailure(failure.message), 'cancelled'));
        return;
      }
      if (!redirectUrl) {
        reject(authError('The sign-in window closed before the sign-in was complete.', 'cancelled'));
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

/** Change a browser error into a message for the user. */
function signInFailure(message) {
  const text = String(message ?? '');
  if (/cancel|closed|did not approve/i.test(text)) return 'You cancelled the sign-in.';
  return text ? `The sign-in did not complete. ${text}` : 'The sign-in did not complete.';
}

/* ---------- storage ---------- */

/** Return true if the local extension storage is available. */
function hasLocal() {
  return Boolean(globalThis.chrome?.storage?.local);
}

async function readLocal(key) {
  if (!hasLocal()) return undefined;
  try {
    const got = await chrome.storage.local.get(key);
    return got?.[key];
  } catch {
    // A storage failure gives the signed-out state. This is the safe result.
    return undefined;
  }
}

async function writeLocal(key, value) {
  if (!hasLocal()) return;
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch {
    // Ignore the failure. The next read gives the signed-out state.
  }
}

async function removeLocal(keys) {
  if (!hasLocal()) return;
  try {
    await chrome.storage.local.remove(keys);
  } catch {
    // Ignore the failure.
  }
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
