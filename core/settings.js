/**
 * Extension settings in chrome.storage.sync, with a memory fallback.
 * getSettings always gives a complete object, with defaults for missing keys.
 */

/**
 * The default value of each setting. The duplicate check is on, because a
 * duplicate item costs more work than the request it takes to find one.
 */
export const DEFAULTS = {
  checkDuplicates: true,
  saveMethod: 'api',
};

/**
 * How an item reaches Wikidata: 'api' saves it from the popup, after the
 * confirm step; 'form' opens a prefilled Special:NewItem instead.
 */
export const SAVE_METHODS = ['api', 'form'];

/** Holds the settings when chrome.storage is not available. */
let memory = { ...DEFAULTS };

/** True when the extension storage API is available. */
function hasStorage() {
  return Boolean(globalThis.chrome?.storage?.sync);
}

/**
 * Read all the settings. A missing key gets its default, so a new setting
 * needs no migration step.
 *
 * @returns {Promise<typeof DEFAULTS>}
 */
export async function getSettings() {
  if (!hasStorage()) return { ...memory };

  try {
    const stored = await chrome.storage.sync.get(DEFAULTS);
    return clean({ ...DEFAULTS, ...stored });
  } catch {
    // A storage failure must not stop the popup.
    return { ...DEFAULTS };
  }
}

/**
 * Replace an incorrect stored value with its default, so a damaged store
 * cannot leave a control with nothing selected.
 *
 * @param {typeof DEFAULTS} s
 * @returns {typeof DEFAULTS}
 */
function clean(s) {
  return {
    checkDuplicates:
      typeof s.checkDuplicates === 'boolean' ? s.checkDuplicates : DEFAULTS.checkDuplicates,
    saveMethod: SAVE_METHODS.includes(s.saveMethod) ? s.saveMethod : DEFAULTS.saveMethod,
  };
}

/**
 * Write one setting.
 *
 * @param {keyof typeof DEFAULTS} key
 * @param {boolean | string} value
 * @returns {Promise<void>}
 */
export async function setSetting(key, value) {
  memory = { ...memory, [key]: value };
  if (!hasStorage()) return;

  try {
    await chrome.storage.sync.set({ [key]: value });
  } catch {
    // The value stays in memory for this popup.
  }
}
