/**
 * Keep the settings in chrome.storage.sync, or in memory if it is not available.
 * getSettings always gives a complete object. Missing keys get their defaults.
 */

import { cleanFilters } from './filters.js';

/** The default value of each setting. */
export const DEFAULTS = {
  checkDuplicates: true,
  excludeRomanized: true,
  saveMethod: 'api',
  textFilters: [],
};

/**
 * The save methods. 'api' saves from the popup after the confirm step.
 * 'form' opens a prefilled Special:NewItem.
 */
export const SAVE_METHODS = ['api', 'form'];

/** The settings when chrome.storage is not available. */
let memory = { ...DEFAULTS };

/** Return true if the extension storage API is available. */
function hasStorage() {
  return Boolean(globalThis.chrome?.storage?.sync);
}

/**
 * Read all the settings. A missing key gets its default.
 * @returns {Promise<typeof DEFAULTS>}
 */
export async function getSettings() {
  if (!hasStorage()) return { ...memory };

  try {
    const stored = await chrome.storage.sync.get(DEFAULTS);
    return clean({ ...DEFAULTS, ...stored });
  } catch {
    // Use the defaults if storage fails. The popup must continue.
    return { ...DEFAULTS };
  }
}

/**
 * Replace an incorrect stored value with its default.
 * @param {typeof DEFAULTS} s
 * @returns {typeof DEFAULTS}
 */
function clean(s) {
  return {
    checkDuplicates:
      typeof s.checkDuplicates === 'boolean' ? s.checkDuplicates : DEFAULTS.checkDuplicates,
    excludeRomanized:
      typeof s.excludeRomanized === 'boolean' ? s.excludeRomanized : DEFAULTS.excludeRomanized,
    saveMethod: SAVE_METHODS.includes(s.saveMethod) ? s.saveMethod : DEFAULTS.saveMethod,
    textFilters: cleanFilters(s.textFilters),
  };
}

/**
 * Write one setting.
 * @param {keyof typeof DEFAULTS} key
 * @param {boolean | string | object[]} value
 * @returns {Promise<void>}
 */
export async function setSetting(key, value) {
  memory = { ...memory, [key]: value };
  if (!hasStorage()) return;

  try {
    await chrome.storage.sync.set({ [key]: value });
  } catch {
    // Keep the value in memory for this popup.
  }
}
