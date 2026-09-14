import { fetchRecord } from './core/lcClient.js';
import { parseMarcLite } from './core/marcLite.js';
import { idFromUrl } from './core/extract.js';
import { mapRecord } from './core/mapper.js';
import { newItemUrl } from './core/newitem.js';
import { findDuplicates } from './core/wikidata.js';
import { getSettings } from './core/settings.js';

const POPUP = 'popup/popup.html';

/** How long a badge stays on the icon. */
const BADGE_MS = 4000;

/**
 * Set or remove the popup to match the setting. The browser calls onClicked
 * only when no popup is set.
 *
 * @param {string} clickAction
 */
async function applyClickAction(clickAction) {
  const popup = clickAction === 'create' ? '' : POPUP;
  try {
    await chrome.action.setPopup({ popup });
  } catch {
    // A failure here leaves the previous behaviour. This is not a serious
    // failure.
  }
}

/**
 * Read the setting and apply it. The worker keeps the promise, so a click
 * that arrives during startup waits for the correct behaviour.
 */
let ready = null;

function syncClickAction() {
  ready = (async () => {
    const { clickAction } = await getSettings();
    await applyClickAction(clickAction);
    return clickAction;
  })();
  return ready;
}

// Apply the setting when the browser starts and when the extension loads.
chrome.runtime.onInstalled.addListener(syncClickAction);
chrome.runtime.onStartup.addListener(syncClickAction);
syncClickAction();

// Apply a new value at once and replace what `ready` holds. Without this a
// click would use the value from worker startup.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.clickAction) {
    const next = changes.clickAction.newValue;
    ready = applyClickAction(next).then(() => next);
  }
});

/** The icon was clicked and no popup is set, so the behaviour is `create`. */
chrome.action.onClicked.addListener(async (tab) => {
  // The worker can start on this click, so wait for the stored setting.
  const clickAction = await (ready ?? syncClickAction());
  if (clickAction !== 'create') return openPopup();

  const id = tab?.url ? idFromUrl(tab.url) : undefined;

  // No identifier in the address. The user must type one, so open the popup.
  if (!id) return openPopup();

  try {
    badge('...', '#4e2a84');

    const { xml } = await fetchRecord(id);
    // A service worker has no DOMParser. Thus the worker uses marcLite.js.
    const draft = mapRecord(parseMarcLite(xml, id));

    // No label would give an empty form. The popup shows the reason.
    if (!draft.label) {
      clearBadge();
      return openPopup();
    }

    const { checkDuplicates } = await getSettings();
    if (checkDuplicates) {
      const dup = await findDuplicates(draft.lcnafId);
      // A duplicate must not reach Wikidata unseen. A failed check fails
      // open, as it does in the popup.
      if (dup.status === 'duplicate') {
        clearBadge();
        return openPopup();
      }
    }

    clearBadge();
    await chrome.tabs.create({ url: newItemUrl(draft) });
  } catch {
    // The fetch or the mapping failed. The popup shows the error.
    clearBadge();
    openPopup();
  }
});

/**
 * Open the popup. openPopup needs a popup set, which `create` removes, so this
 * sets it, opens it and removes it again.
 */
async function openPopup() {
  try {
    await chrome.action.setPopup({ popup: POPUP });
    await chrome.action.openPopup();
    await chrome.action.setPopup({ popup: '' });
    return;
  } catch {
    // Firefox does not always permit openPopup. Fall through to a tab.
  }

  // Open the popup as a usual tab, so the click always does something.
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL(POPUP) });
  } catch {
    // The popup stays set, so the next click opens it.
    badge('!', '#a02631');
  }
}

/**
 * Put a short text on the icon.
 * @param {string} text
 * @param {string} colour
 */
function badge(text, colour) {
  try {
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color: colour });
    setTimeout(clearBadge, BADGE_MS);
  } catch {
    // The badge is not necessary.
  }
}

function clearBadge() {
  try {
    chrome.action.setBadgeText({ text: '' });
  } catch {
    // Not necessary.
  }
}
