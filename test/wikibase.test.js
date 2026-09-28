/**
 * Test the write client. A replacement globalThis.fetch prevents calls to Wikidata.
 * The token is optional. Only the Authorization header changes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { addStatement, createItem, getItem, patchItem } = await import('../core/wikibase.js');

const realFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Make a response object with a JSON body. */
function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** A draft with all fields filled in. */
function draft(over = {}) {
  return {
    lcnafId: 'n50044114',
    lang: 'en',
    label: 'Mark Twain',
    description: 'author (1835-1910)',
    aliases: ['Samuel Langhorne Clemens'],
    warnings: [],
    ...over,
  };
}

/* ---------- signed out and signed in ---------- */

test('a create with no token still saves, and sends no Authorization', async () => {
  let init;
  globalThis.fetch = async (url, opts) => {
    init = opts;
    return jsonResponse({ id: 'Q123' }, 201);
  };

  const item = await createItem(draft(), {});

  assert.equal(item.id, 'Q123');
  assert.equal(init.headers.Authorization, undefined, 'no header when signed out');
  // Always send the policy header.
  assert.match(init.headers['Api-User-Agent'], /LCNAF2Wiki/);
});

test('an empty token is treated as no token, not as an empty header', async () => {
  let init;
  globalThis.fetch = async (url, opts) => {
    init = opts;
    return jsonResponse({ id: 'Q123' }, 201);
  };

  await createItem(draft(), { accessToken: '' });

  assert.equal(init.headers.Authorization, undefined);
});

test('a statement with no token still saves', async () => {
  let init;
  globalThis.fetch = async (url, opts) => {
    init = opts;
    return jsonResponse({}, 201);
  };

  await addStatement('Q1', {}, {});

  assert.equal(init.headers.Authorization, undefined);
});

test('an item with neither a label nor a description is refused', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return jsonResponse({ id: 'Q1' }, 201);
  };

  await assert.rejects(
    createItem(draft({ label: '', description: '' }), { accessToken: 'AT' }),
    (err) => err.code === 'empty-item',
  );
  assert.equal(called, false);
});

/* ---------- the request ---------- */

test('a create sends the bearer token and a descriptive user agent', async () => {
  let init;
  globalThis.fetch = async (url, opts) => {
    init = opts;
    return jsonResponse({ id: 'Q123', labels: { en: 'Mark Twain' } }, 201);
  };

  await createItem(draft(), { accessToken: 'AT' });

  assert.equal(init.headers.Authorization, 'Bearer AT');
  assert.match(init.headers['Api-User-Agent'], /LCNAF2Wiki/);
  assert.equal(init.method, 'POST');
});

test('a create sends the label, description and aliases under the language', async () => {
  let body;
  globalThis.fetch = async (url, opts) => {
    body = JSON.parse(opts.body);
    return jsonResponse({ id: 'Q123' }, 201);
  };

  await createItem(draft(), { accessToken: 'AT' });

  assert.equal(body.item.labels.en, 'Mark Twain');
  assert.equal(body.item.descriptions.en, 'author (1835-1910)');
  assert.deepEqual(body.item.aliases.en, ['Samuel Langhorne Clemens']);
});

test('a create sends the LCNAF id as P244 and human as P31', async () => {
  let body;
  globalThis.fetch = async (url, opts) => {
    body = JSON.parse(opts.body);
    return jsonResponse({ id: 'Q123' }, 201);
  };

  await createItem(draft(), { accessToken: 'AT' });

  assert.equal(body.item.statements.P244[0].value.content, 'n50044114');
  assert.equal(body.item.statements.P31[0].value.content, 'Q5');
});

test('the edit comment names the source record, for a watchlist', async () => {
  let body;
  globalThis.fetch = async (url, opts) => {
    body = JSON.parse(opts.body);
    return jsonResponse({ id: 'Q123' }, 201);
  };

  await createItem(draft(), { accessToken: 'AT' });

  assert.match(body.comment, /n50044114/);
});

test('an empty alias list sends no alias key', async () => {
  let body;
  globalThis.fetch = async (url, opts) => {
    body = JSON.parse(opts.body);
    return jsonResponse({ id: 'Q123' }, 201);
  };

  await createItem(draft({ aliases: [] }), { accessToken: 'AT' });

  assert.deepEqual(body.item.aliases, {});
});

/* ---------- the answer ---------- */

test('a created item gives back its id and address', async () => {
  globalThis.fetch = async () =>
    jsonResponse({ id: 'Q123', labels: { en: 'Mark Twain' } }, 201);

  const item = await createItem(draft(), { accessToken: 'AT' });

  assert.equal(item.id, 'Q123');
  assert.equal(item.url, 'https://www.wikidata.org/wiki/Q123');
});

test('an expired token reads as signed out, so the caller can ask again', async () => {
  globalThis.fetch = async () => jsonResponse({}, 401);

  await assert.rejects(
    createItem(draft(), { accessToken: 'stale' }),
    (err) => err.code === 'signed-out',
  );
});

test('a blocked account is reported with the reason Wikidata gave', async () => {
  globalThis.fetch = async () =>
    jsonResponse({ messageTranslations: { en: 'You are blocked.' } }, 403);

  await assert.rejects(
    createItem(draft(), { accessToken: 'AT' }),
    (err) => err.code === 'forbidden' && err.message === 'You are blocked.',
  );
});

test('a rate limit says to wait, not that the save failed', async () => {
  globalThis.fetch = async () => jsonResponse({}, 429);

  await assert.rejects(
    createItem(draft(), { accessToken: 'AT' }),
    (err) => err.code === 'rate-limit' && /wait/i.test(err.message),
  );
});

test('a refused value carries the message from Wikidata', async () => {
  globalThis.fetch = async () =>
    jsonResponse(
      {
        errorKey: 'data-policy-violation',
        messageTranslations: { en: 'An item with this label and description exists.' },
      },
      422,
    );

  await assert.rejects(
    createItem(draft(), { accessToken: 'AT' }),
    (err) => /label and description exists/.test(err.message),
  );
});

test('a network failure is reported, not thrown raw', async () => {
  globalThis.fetch = async () => {
    throw new Error('offline');
  };

  await assert.rejects(
    createItem(draft(), { accessToken: 'AT' }),
    (err) => err.code === 'network',
  );
});

test('a saved item with no id is reported rather than passed on', async () => {
  globalThis.fetch = async () => jsonResponse({ labels: {} }, 201);

  await assert.rejects(
    createItem(draft(), { accessToken: 'AT' }),
    (err) => err.code === 'no-id',
  );
});

/* ---------- reading ---------- */

test('a read needs no token', async () => {
  let init;
  globalThis.fetch = async (url, opts) => {
    init = opts;
    return jsonResponse({ id: 'Q42' });
  };

  const item = await getItem('Q42');

  assert.equal(item.id, 'Q42');
  assert.equal(init.headers.Authorization, undefined);
});

/* ---------- patching ---------- */

test('a patch refuses any operation that is not an add', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return jsonResponse({ id: 'Q1' });
  };

  // This is the last check before a write that removes data.
  for (const op of ['replace', 'remove', 'move', 'copy']) {
    await assert.rejects(
      patchItem('Q1', [{ op, path: '/labels/en', value: 'x' }], { accessToken: 'AT' }),
      (err) => err.code === 'not-additive',
    );
  }

  assert.equal(called, false, 'nothing may reach Wikidata');
});

test('an empty patch is refused rather than sent', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return jsonResponse({});
  };

  await assert.rejects(patchItem('Q1', [], { accessToken: 'AT' }), (err) => err.code === 'empty-patch');
  assert.equal(called, false);
});

test('a patch is sent as JSON Patch, with the comment', async () => {
  let init;
  globalThis.fetch = async (url, opts) => {
    init = opts;
    return jsonResponse({ id: 'Q1' });
  };

  await patchItem('Q1', [{ op: 'add', path: '/labels/en', value: 'X' }], {
    accessToken: 'AT',
    comment: 'Added from LCNAF n1',
  });

  assert.equal(init.method, 'PATCH');
  assert.equal(init.headers['Content-Type'], 'application/json-patch+json');
  assert.equal(JSON.parse(init.body).comment, 'Added from LCNAF n1');
});

test('an item that changed since the read reports a conflict', async () => {
  globalThis.fetch = async () => jsonResponse({}, 409);

  await assert.rejects(
    patchItem('Q1', [{ op: 'add', path: '/labels/en', value: 'X' }], { accessToken: 'AT' }),
    (err) => err.code === 'conflict',
  );
});
