/**
 * Test the LC client. A replacement globalThis.fetch prevents calls to id.loc.gov.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { findIdByHeading } = await import('../core/lcClient.js');

/** Replace fetch with one response, and record the request. */
function answer(status, finalUrl) {
  const seen = {};
  globalThis.fetch = async (url, init) => {
    Object.assign(seen, { url, init });
    return { status, ok: status >= 200 && status < 300, statusText: '', url: finalUrl, body: null };
  };
  return seen;
}

test('a heading gives the LCCN from the redirect', async () => {
  const seen = answer(200, 'https://id.loc.gov/authorities/names/n79021164.json');

  assert.equal(await findIdByHeading('Twain, Mark, 1835-1910'), 'n79021164');
  assert.equal(seen.url, 'https://id.loc.gov/authorities/names/label/Twain%2C%20Mark%2C%201835-1910');
  assert.equal(seen.init.headers.Accept, 'application/json');
});

test('an unknown heading is not found', async () => {
  answer(404, 'https://id.loc.gov/authorities/names/label/Nobody');

  await assert.rejects(findIdByHeading('Nobody'), (err) => err.code === 'not-found');
});

test('a redirect to something that is not an LCCN is not found', async () => {
  answer(200, 'https://id.loc.gov/authorities/names/label/Twain');

  await assert.rejects(findIdByHeading('Twain'), (err) => err.code === 'not-found');
});

test('an empty heading does not reach the network', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
  };

  await assert.rejects(findIdByHeading('  '), (err) => err.code === 'not-found');
  assert.equal(called, false);
});

test('a network failure is a network error', async () => {
  globalThis.fetch = async () => {
    throw new Error('offline');
  };

  await assert.rejects(findIdByHeading('Twain, Mark'), (err) => err.code === 'network');
});
