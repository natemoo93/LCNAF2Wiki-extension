/**
 * Test the client ID. The extension has a built-in client.
 * A stored client ID replaces the built-in client ID.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

/** A replacement for chrome.storage.local. */
let store = {};

globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        return typeof key === 'string' ? { [key]: store[key] } : { ...store };
      },
      async set(patch) {
        Object.assign(store, patch);
      },
      async remove(keys) {
        for (const k of [].concat(keys)) delete store[k];
      },
    },
  },
};

const { getBuiltInClientId, getClientId, getSession, setClientId } = await import('../core/auth.js');

test.beforeEach(() => {
  store = {};
});

test('with nothing stored, the built-in client is used', async () => {
  assert.equal(await getClientId(), getBuiltInClientId());
});

test('a stored override wins over the built-in client', async () => {
  await setClientId('institutionalkey123');
  assert.equal(await getClientId(), 'institutionalkey123');
});

test('an override is trimmed, because a pasted key often carries spaces', async () => {
  store.oauthClientId = '  spacedkey  ';
  assert.equal(await getClientId(), 'spacedkey');
});

test('clearing the override returns to the built-in client', async () => {
  await setClientId('institutionalkey123');
  await setClientId('');
  assert.equal(await getClientId(), getBuiltInClientId());
});

test('changing the client signs the user out, because a token belongs to one client', async () => {
  store.oauthTokens = { accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() + 1e6 };
  store.oauthAccount = { username: 'Ncataloger' };

  await setClientId('a-different-client');

  assert.equal(store.oauthTokens, undefined);
  assert.equal(store.oauthAccount, undefined);
});

test('setting the same value again keeps the session', async () => {
  await setClientId('samekey');
  store.oauthTokens = { accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() + 1e6 };
  store.oauthAccount = { username: 'Ncataloger' };

  await setClientId('samekey');

  assert.ok(store.oauthTokens, 'an unchanged client must not sign the user out');
});

test('an empty value with no override stored keeps the session', async () => {
  store.oauthTokens = { accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() + 1e6 };
  store.oauthAccount = { username: 'Ncataloger' };

  // The settings field is empty for the built-in client.
  // An empty value must not sign the user out.
  await setClientId('');

  assert.ok(store.oauthTokens, 'an untouched empty field must not sign the user out');
});

test('the build has a client ID, so a new user is signed out, not unconfigured', async () => {
  assert.ok(getBuiltInClientId(), 'the built-in client ID must not be empty');
  assert.deepEqual(await getSession(), { state: 'out' });
});
