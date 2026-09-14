/**
 * Settings tests, with chrome.storage.sync replaced by a small object.
 * A missing or incorrect stored value must get its default.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

/** A fake chrome.storage.sync that holds the given data. */
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

const { DEFAULTS, CLICK_ACTIONS, getSettings, setSetting } = await import('../core/settings.js');

test.afterEach(() => {
  delete globalThis.chrome;
});

test('the defaults are a duplicate check that is off and the menu behaviour', () => {
  assert.equal(DEFAULTS.checkDuplicates, false);
  assert.equal(DEFAULTS.clickAction, 'menu');
});

test('the click actions are menu and create', () => {
  assert.deepEqual(CLICK_ACTIONS, ['menu', 'create']);
});

test('an empty store gives the defaults', async () => {
  stubStorage({});
  assert.deepEqual(await getSettings(), DEFAULTS);
});

test('a stored value replaces the default', async () => {
  stubStorage({ checkDuplicates: true, clickAction: 'create' });
  const s = await getSettings();
  assert.equal(s.checkDuplicates, true);
  assert.equal(s.clickAction, 'create');
});

test('a missing key gets its default', async () => {
  // A new setting must not need a migration step.
  stubStorage({ checkDuplicates: true });
  const s = await getSettings();
  assert.equal(s.clickAction, 'menu');
});

test('an incorrect clickAction gets the default', async () => {
  stubStorage({ clickAction: 'nonsense' });
  assert.equal((await getSettings()).clickAction, 'menu');
});

test('a clickAction that is not a string gets the default', async () => {
  stubStorage({ clickAction: 7 });
  assert.equal((await getSettings()).clickAction, 'menu');
});

test('a checkDuplicates value that is not a boolean becomes false', async () => {
  stubStorage({ checkDuplicates: 'yes' });
  assert.equal((await getSettings()).checkDuplicates, false);
});

test('a storage failure gives the defaults and does not throw', async () => {
  stubStorage({}, { fail: true });
  assert.deepEqual(await getSettings(), DEFAULTS);
});

test('setSetting writes to the store', async () => {
  const data = {};
  stubStorage(data);
  await setSetting('clickAction', 'create');
  assert.equal(data.clickAction, 'create');
});

test('setSetting does not throw when the store fails', async () => {
  stubStorage({}, { fail: true });
  await setSetting('clickAction', 'create');
});

test('the settings work with no chrome API at all', async () => {
  // The popup can open as a usual page in a test.
  delete globalThis.chrome;
  const s = await getSettings();
  assert.equal(typeof s.checkDuplicates, 'boolean');
  assert.ok(CLICK_ACTIONS.includes(s.clickAction));
});
