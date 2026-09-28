/**
 * Test the settings with a replacement chrome.storage.sync.
 * A missing or incorrect stored value must get its default.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

/** A replacement chrome.storage.sync with the given data. */
function stubStorage(data, { fail = false } = {}) {
  globalThis.chrome = {
    storage: {
      sync: {
        async get(defaults) {
          if (fail) throw new Error('storage unavailable');
          const out = { ...defaults };
          for (const k of Object.keys(defaults)) {
            if (k in data) out[k] = data[k];
          }
          return out;
        },
        async set(patch) {
          if (fail) throw new Error('storage unavailable');
          Object.assign(data, patch);
        },
      },
    },
  };
}

const { DEFAULTS, SAVE_METHODS, getSettings, setSetting } = await import('../core/settings.js');

test.afterEach(() => {
  delete globalThis.chrome;
});

test('an empty store gives the defaults', async () => {
  stubStorage({});
  assert.deepEqual(await getSettings(), DEFAULTS);
});

test('an excludeRomanized value that is not a boolean gets the default', async () => {
  stubStorage({ excludeRomanized: 'yes' });
  assert.equal((await getSettings()).excludeRomanized, DEFAULTS.excludeRomanized);
});

test('a stored false stays false', async () => {
  // The default is true, so the check must keep a false value.
  stubStorage({ excludeRomanized: false });
  assert.equal((await getSettings()).excludeRomanized, false);
});

test('an old checkDuplicates value in storage is ignored', async () => {
  // The duplicate check is always on. It is not a setting now.
  stubStorage({ checkDuplicates: false });
  assert.equal('checkDuplicates' in (await getSettings()), false);
});

test('a storage failure gives the defaults and does not throw', async () => {
  stubStorage({}, { fail: true });
  assert.deepEqual(await getSettings(), DEFAULTS);
});

test('an incorrect saveMethod falls back to its default', async () => {
  stubStorage({ saveMethod: 'telepathy' });
  const settings = await getSettings();
  assert.equal(settings.saveMethod, 'api');
});

test('a stored saveMethod is kept', async () => {
  stubStorage({ saveMethod: 'form' });
  const settings = await getSettings();
  assert.equal(settings.saveMethod, 'form');
});

test('a setting is written to the store', async () => {
  const data = {};
  stubStorage(data);

  await setSetting('saveMethod', 'form');

  assert.equal(data.saveMethod, 'form');
});

test('a write that fails does not throw', async () => {
  stubStorage({}, { fail: true });

  // The popup must continue to operate if storage refuses a write.
  await setSetting('saveMethod', 'form');
});

test('every default passes its own check', async () => {
  // Each default must be a value that the cleaner accepts.
  stubStorage({});
  const s = await getSettings();

  assert.equal(typeof s.excludeRomanized, 'boolean');
  assert.ok(SAVE_METHODS.includes(s.saveMethod));
});

test('text filters come back from the store', async () => {
  stubStorage({ textFilters: [{ replace: 'a', with: 'b' }] });
  const settings = await getSettings();

  assert.deepEqual(settings.textFilters, [{ replace: 'a', with: 'b' }]);
});

test('a damaged filter list does not stop the settings loading', async () => {
  stubStorage({ textFilters: 'not a list' });
  const settings = await getSettings();

  assert.deepEqual(settings.textFilters, []);
  assert.equal(settings.excludeRomanized, DEFAULTS.excludeRomanized);
});

test('an empty store gives no filters', async () => {
  stubStorage({});
  assert.deepEqual((await getSettings()).textFilters, []);
});
