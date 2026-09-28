/**
 * Test the duplicate check. A replacement globalThis.fetch prevents calls to Wikidata.
 * A failed check must unlock the button.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { findByViaf, findDuplicates } = await import('../core/wikidata.js');

const realFetch = globalThis.fetch;

/** Replace fetch with one prepared answer. */
function stubFetch(answer) {
  globalThis.fetch = async () => answer;
}

/** Make a response object with a JSON body. */
function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** A search answer with the given item titles. */
function searchBody(titles) {
  return { query: { searchinfo: { totalhits: titles.length }, search: titles.map((t) => ({ title: t })) } };
}

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

test('no match gives the status none', async () => {
  stubFetch(jsonResponse(searchBody([])));
  const r = await findDuplicates('n50044114');
  assert.equal(r.status, 'none');
  assert.deepEqual(r.items, []);
});

test('a match gives the status duplicate with an item and a url', async () => {
  stubFetch(jsonResponse(searchBody(['Q138417164'])));
  const r = await findDuplicates('no2012063640');
  assert.equal(r.status, 'duplicate');
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].id, 'Q138417164');
  assert.equal(r.items[0].url, 'https://www.wikidata.org/wiki/Q138417164');
});

test('more than one match gives each item', async () => {
  stubFetch(jsonResponse(searchBody(['Q1', 'Q2'])));
  const r = await findDuplicates('n12345');
  assert.equal(r.status, 'duplicate');
  assert.deepEqual(r.items.map((i) => i.id), ['Q1', 'Q2']);
});

test('an empty identifier gives an error and does not call the API', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return jsonResponse(searchBody([]));
  };
  const r = await findDuplicates('');
  assert.equal(r.status, 'error');
  assert.equal(called, false);
});

test('a rate limit gives an error, not a false none', async () => {
  // A 429 is not proof that the item does not exist.
  stubFetch(jsonResponse({}, 429));
  const r = await findDuplicates('n50044114');
  assert.equal(r.status, 'error');
  assert.match(r.detail, /rate limit/i);
});

test('a server failure gives an error', async () => {
  stubFetch(jsonResponse({}, 503));
  const r = await findDuplicates('n50044114');
  assert.equal(r.status, 'error');
  assert.match(r.detail, /503/);
});

test('an API error in the body gives an error', async () => {
  // The action API gives its errors with a 200 status.
  stubFetch(jsonResponse({ error: { info: 'Invalid search query.' } }));
  const r = await findDuplicates('n50044114');
  assert.equal(r.status, 'error');
  assert.equal(r.detail, 'Invalid search query.');
});

test('a network failure gives an error', async () => {
  globalThis.fetch = async () => {
    throw new Error('network down');
  };
  const r = await findDuplicates('n50044114');
  assert.equal(r.status, 'error');
  assert.match(r.detail, /network down/);
});

test('a cancelled check reports that it was cancelled', async () => {
  globalThis.fetch = async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  };
  const ctl = new AbortController();
  ctl.abort();
  const r = await findDuplicates('n50044114', { signal: ctl.signal });
  assert.equal(r.status, 'error');
  assert.match(r.detail, /cancelled/i);
});

test('the request asks for an exact P244 statement', async () => {
  let seen = '';
  globalThis.fetch = async (url) => {
    seen = String(url);
    return jsonResponse(searchBody([]));
  };
  await findDuplicates('n50044114');
  assert.match(decodeURIComponent(seen), /haswbstatement:P244=n50044114/);
});

test('the request sends a descriptive user agent', async () => {
  // Wikimedia refuses a request with no User-Agent.
  let headers = {};
  globalThis.fetch = async (url, opts) => {
    headers = opts.headers;
    return jsonResponse(searchBody([]));
  };
  await findDuplicates('n50044114');
  assert.match(headers['Api-User-Agent'], /LCNAF2Wiki/);
});

/* ---------- the VIAF search ---------- */

test('a VIAF match is a duplicate, and says which identifier found it', async () => {
  stubFetch(jsonResponse(searchBody(['Q42'])));

  const result = await findByViaf('113230702');

  assert.equal(result.status, 'duplicate');
  assert.equal(result.matchedBy, 'viaf');
  assert.equal(result.items[0].id, 'Q42');
  assert.equal(result.items[0].url, 'https://www.wikidata.org/wiki/Q42');
});

test('the VIAF request asks for an exact P214 statement', async () => {
  let asked;
  globalThis.fetch = async (url) => {
    asked = String(url);
    return jsonResponse(searchBody([]));
  };

  await findByViaf('113230702');

  assert.match(decodeURIComponent(asked), /haswbstatement:P214=113230702/);
});

test('no VIAF match gives none, so the button unlocks', async () => {
  stubFetch(jsonResponse(searchBody([])));

  const result = await findByViaf('113230702');

  assert.equal(result.status, 'none');
});

test('a VIAF value that is not a number never reaches the network', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return jsonResponse(searchBody(['Q42']));
  };

  const result = await findByViaf('not-a-number');

  assert.equal(result.status, 'error');
  assert.equal(called, false, 'a text value would search for text, not an id');
});

test('an empty VIAF value is an error, not a search', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return jsonResponse(searchBody([]));
  };

  const result = await findByViaf('');

  assert.equal(result.status, 'error');
  assert.equal(called, false);
});

test('a VIAF check that fails fails open, like the P244 one', async () => {
  stubFetch(jsonResponse({}, 503));

  const result = await findByViaf('113230702');

  // An error is not proof that no item exists.
  assert.equal(result.status, 'error');
  assert.deepEqual(result.items, []);
});

test('a P244 match reports that the LCNAF id found it', async () => {
  stubFetch(jsonResponse(searchBody(['Q42'])));

  const result = await findDuplicates('n80076765');

  assert.equal(result.matchedBy, 'lcnaf');
});
