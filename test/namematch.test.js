/**
 * Test the name and date match. A replacement globalThis.fetch prevents calls to Wikidata.
 * Test the failure result, the two years, and the escape characters.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { findNameMatches, buildQuery, YEAR_TOLERANCE } = await import('../core/namematch.js');

const realFetch = globalThis.fetch;

/** Replace fetch with one prepared answer. */
function stubFetch(answer) {
  globalThis.fetch = async () => answer;
}

/** Make a response object with a JSON body. */
function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** A SPARQL answer with the given items. */
function bindings(rows) {
  return {
    results: {
      bindings: rows.map((r) => ({
        item: { value: `http://www.wikidata.org/entity/${r.id}` },
        itemLabel: { value: r.label ?? '' },
        birth: { value: String(r.birth ?? '') },
        death: { value: String(r.death ?? '') },
      })),
    },
  };
}

/** A draft with a name and both years. */
function draft(over = {}) {
  return { label: 'Ada Lovelace', birth: { year: 1815 }, death: { year: 1852 }, ...over };
}

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

test('no row gives the status none', async () => {
  stubFetch(jsonResponse(bindings([])));
  const r = await findNameMatches(draft());
  assert.equal(r.status, 'none');
  assert.deepEqual(r.items, []);
});

test('a row gives the status possible with an item and a url', async () => {
  stubFetch(jsonResponse(bindings([{ id: 'Q7259', label: 'Ada Lovelace', birth: 1815, death: 1852 }])));
  const r = await findNameMatches(draft());
  assert.equal(r.status, 'possible');
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].id, 'Q7259');
  assert.equal(r.items[0].url, 'https://www.wikidata.org/wiki/Q7259');
  assert.equal(r.items[0].birth, 1815);
});

test('a missing death year skips the check', async () => {
  // A name and one year are not sufficient evidence.
  let called = false;
  globalThis.fetch = async () => { called = true; return jsonResponse(bindings([])); };
  const r = await findNameMatches(draft({ death: undefined }));
  assert.equal(r.status, 'skipped');
  assert.equal(called, false, 'must not call the query service');
});

test('a missing birth year skips the check', async () => {
  const r = await findNameMatches(draft({ birth: undefined }));
  assert.equal(r.status, 'skipped');
});

test('an empty label skips the check', async () => {
  const r = await findNameMatches(draft({ label: '  ' }));
  assert.equal(r.status, 'skipped');
});

test('a rate limit gives an error and not a match', async () => {
  stubFetch(jsonResponse({}, 429));
  const r = await findNameMatches(draft());
  assert.equal(r.status, 'error');
  assert.match(r.detail, /rate limit/i);
});

test('a server error gives an error and not a match', async () => {
  stubFetch(jsonResponse({}, 500));
  const r = await findNameMatches(draft());
  assert.equal(r.status, 'error');
});

test('an unreachable service gives an error and does not throw', async () => {
  globalThis.fetch = async () => { throw new Error('offline'); };
  const r = await findNameMatches(draft());
  assert.equal(r.status, 'error');
});

test('the query excludes an item that already has P244', () => {
  const q = buildQuery('Ada Lovelace', 1815, 1852);
  assert.match(q, /FILTER NOT EXISTS \{ \?item wdt:P244 \?lc \. \}/);
});

test('the query restricts the search to people', () => {
  assert.match(buildQuery('Ada Lovelace', 1815, 1852), /wdt:P31 wd:Q5/);
});

test('the query allows the year tolerance on both dates', () => {
  const q = buildQuery('Ada Lovelace', 1815, 1852);
  assert.match(q, new RegExp(`ABS\\(\\?birth - 1815\\) <= ${YEAR_TOLERANCE}`));
  assert.match(q, new RegExp(`ABS\\(\\?death - 1852\\) <= ${YEAR_TOLERANCE}`));
});

test('a quote in a name cannot end the string literal', () => {
  // A name is record data. It must not change the query.
  const q = buildQuery('O\'Brien "Mac"', 1900, 1980);
  // The literal ends one time only, at the closing quote before @en.
  const literal = q.slice(q.indexOf('rdfs:label ') + 11, q.indexOf('@en'));
  assert.equal(literal.startsWith('"'), true);
  assert.equal(literal.endsWith('"'), true);
  assert.equal(countUnescapedQuotes(literal), 2, 'only the delimiters are unescaped');
});

test('a backslash in a name is escaped', () => {
  const q = buildQuery('A' + String.fromCharCode(92) + 'B', 1900, 1980);
  assert.ok(q.includes(String.fromCharCode(92, 92)), 'a backslash must be doubled');
});

/** Count the quotes that do not have a backslash before them. */
function countUnescapedQuotes(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '"') continue;
    let slashes = 0;
    for (let j = i - 1; j >= 0 && text[j] === String.fromCharCode(92); j--) slashes++;
    if (slashes % 2 === 0) n++;
  }
  return n;
}

test('a row with no usable item is dropped', async () => {
  stubFetch(jsonResponse({ results: { bindings: [{ item: { value: 'not-a-uri' } }] } }));
  const r = await findNameMatches(draft());
  assert.deepEqual(r.items, []);
});
