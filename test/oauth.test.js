/**
 * Test the OAuth protocol. A replacement globalThis.fetch prevents calls to Wikimedia.
 * Test PKCE, the state match, and the used grant.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

// The modules use the web crypto API.
// Put it on the global object for Node.
globalThis.crypto ??= webcrypto;

const { authorizeUrl, createPkcePair, exchangeCode, isExpired, readCallback, refreshTokens } =
  await import('../core/oauth.js');

const realFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Make a response object with a JSON body. */
function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/* ---------- PKCE ---------- */

test('a PKCE pair gives a verifier and a different challenge', async () => {
  const { verifier, challenge } = await createPkcePair();

  assert.ok(verifier.length >= 43, 'the verifier must meet the minimum length');
  assert.notEqual(verifier, challenge, 'the challenge must be the hash, not the verifier');
  // Base64url has no plus, no slash, and no padding.
  assert.match(challenge, /^[A-Za-z0-9_-]+$/);
});

test('each PKCE pair is different', async () => {
  const a = await createPkcePair();
  const b = await createPkcePair();
  assert.notEqual(a.verifier, b.verifier);
});

test('the challenge is the SHA-256 of the verifier', async () => {
  const { verifier, challenge } = await createPkcePair();

  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const expected = Buffer.from(new Uint8Array(digest)).toString('base64url');

  assert.equal(challenge, expected);
});

/* ---------- the authorize address ---------- */

test('the authorize address carries the PKCE challenge and S256', () => {
  const url = new URL(
    authorizeUrl({
      clientId: 'abc123',
      redirectUri: 'https://ext.chromiumapp.org/',
      challenge: 'CHALLENGE',
      state: 'STATE',
    }),
  );

  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), 'abc123');
  assert.equal(url.searchParams.get('code_challenge'), 'CHALLENGE');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), 'STATE');
});

test('the authorize address carries no client secret', () => {
  const url = authorizeUrl({
    clientId: 'abc123',
    redirectUri: 'https://ext.chromiumapp.org/',
    challenge: 'C',
    state: 'S',
  });

  assert.ok(!/secret/i.test(url), 'a public client must send no secret');
});

/* ---------- the callback ---------- */

test('a matching state gives the code', () => {
  const code = readCallback('https://ext.chromiumapp.org/?code=CODE&state=STATE', 'STATE');
  assert.equal(code, 'CODE');
});

test('a state that does not match is refused', () => {
  assert.throws(
    () => readCallback('https://ext.chromiumapp.org/?code=CODE&state=OTHER', 'STATE'),
    (err) => err.code === 'state-mismatch',
  );
});

test('a declined sign-in reads as such', () => {
  assert.throws(
    () => readCallback('https://ext.chromiumapp.org/?error=access_denied&state=STATE', 'STATE'),
    (err) => err.message === 'You declined the sign-in.',
  );
});

test('an answer with no code is refused', () => {
  assert.throws(
    () => readCallback('https://ext.chromiumapp.org/?state=STATE', 'STATE'),
    (err) => err.code === 'no-code',
  );
});

test('the parameters are read from the fragment as well as the query', () => {
  const code = readCallback('https://ext.chromiumapp.org/#code=CODE&state=STATE', 'STATE');
  assert.equal(code, 'CODE');
});

/* ---------- the token exchange ---------- */

test('the code trade sends the verifier and no secret', async () => {
  let sent;
  globalThis.fetch = async (url, init) => {
    sent = new URLSearchParams(init.body);
    return jsonResponse({ access_token: 'AT', refresh_token: 'RT', expires_in: 14400 });
  };

  await exchangeCode({
    clientId: 'abc123',
    code: 'CODE',
    verifier: 'VERIFIER',
    redirectUri: 'https://ext.chromiumapp.org/',
  });

  assert.equal(sent.get('grant_type'), 'authorization_code');
  assert.equal(sent.get('code_verifier'), 'VERIFIER');
  assert.equal(sent.get('client_id'), 'abc123');
  assert.equal(sent.get('client_secret'), null, 'a public client sends no secret');
});

test('the trade turns expires_in into a moment', async () => {
  globalThis.fetch = async () =>
    jsonResponse({ access_token: 'AT', refresh_token: 'RT', expires_in: 100 });

  const before = Date.now();
  const tokens = await exchangeCode({
    clientId: 'a',
    code: 'c',
    verifier: 'v',
    redirectUri: 'r',
  });

  assert.ok(tokens.expiresAt >= before + 100_000);
  assert.equal(tokens.accessToken, 'AT');
  assert.equal(tokens.refreshToken, 'RT');
});

test('a spent refresh token reads as invalid-grant', async () => {
  globalThis.fetch = async () =>
    jsonResponse({ error: 'invalid_grant', error_description: 'Token expired' }, 400);

  await assert.rejects(
    refreshTokens({ clientId: 'a', refreshToken: 'gone' }),
    (err) => err.code === 'invalid-grant',
  );
});

test('an answer with no access token is refused', async () => {
  globalThis.fetch = async () => jsonResponse({ token_type: 'Bearer' });

  await assert.rejects(
    exchangeCode({ clientId: 'a', code: 'c', verifier: 'v', redirectUri: 'r' }),
    (err) => err.code === 'token-failed',
  );
});

test('a network failure is reported, not thrown raw', async () => {
  globalThis.fetch = async () => {
    throw new Error('offline');
  };

  await assert.rejects(
    refreshTokens({ clientId: 'a', refreshToken: 'r' }),
    (err) => err.code === 'network',
  );
});

/* ---------- expiry ---------- */

test('a missing token counts as expired', () => {
  assert.equal(isExpired(undefined), true);
  assert.equal(isExpired({ accessToken: '', expiresAt: Date.now() + 1e6 }), true);
});

test('a token well inside its life is not expired', () => {
  const now = 1_000_000;
  assert.equal(isExpired({ accessToken: 'AT', expiresAt: now + 3_600_000 }, now), false);
});

test('a token close to expiry counts as expired, so it refreshes early', () => {
  const now = 1_000_000;
  // Sixty seconds remain. This is less than the two-minute margin.
  assert.equal(isExpired({ accessToken: 'AT', expiresAt: now + 60_000 }, now), true);
});

test('a token with no expiry counts as expired', () => {
  assert.equal(isExpired({ accessToken: 'AT', expiresAt: NaN }), true);
});
