/**
 * Control the settings page. Write each change immediately.
 */

import { getSettings, setSetting } from '../core/settings.js';
import { cleanFilters, MAX_FILTERS } from '../core/filters.js';
import {
  getBuiltInClientId,
  getClientId,
  getRedirectUri,
  getSession,
  setClientId,
  signIn,
  signOut,
  REGISTER_URL,
} from '../core/auth.js';

/** The address of the documentation link. */
const DOCS_URL = 'https://github.com/natemoo93/LCNAF2Wiki-extension';

/** The page where a user withdraws the permission for this extension. */
const GRANTS_URL = 'https://meta.wikimedia.org/wiki/Special:OAuthManageMyGrants';

const dupToggle = document.getElementById('check-duplicates');
const romanizedToggle = document.getElementById('exclude-romanized');
const saveRadios = document.querySelectorAll('input[name="save-method"]');
const clientInput = document.getElementById('client-id');
const accountState = document.getElementById('account-state');
const redirectBox = document.getElementById('redirect-uri');
const filterList = document.getElementById('filters');
const addFilterButton = document.getElementById('add-filter');

/**
 * The filters on the page. Write them to storage after each change.
 * @type {{replace: string, with: string}[]}
 */
let filters = [];

init();

async function init() {
  document.getElementById('docs').href = DOCS_URL;
  document.getElementById('register').href = REGISTER_URL;

  // Show the callback address. The browser makes it from the extension ID.
  try {
    redirectBox.textContent = getRedirectUri();
  } catch {
    // An old browser has no identity API. The account panel tells the user.
  }

  const settings = await getSettings();

  dupToggle.checked = settings.checkDuplicates;
  dupToggle.addEventListener('change', () => {
    setSetting('checkDuplicates', dupToggle.checked);
  });

  romanizedToggle.checked = settings.excludeRomanized;
  romanizedToggle.addEventListener('change', () => {
    setSetting('excludeRomanized', romanizedToggle.checked);
  });

  for (const radio of saveRadios) {
    radio.checked = radio.value === settings.saveMethod;
    radio.addEventListener('change', () => {
      if (radio.checked) setSetting('saveMethod', radio.value);
    });
  }

  filters = Array.isArray(settings.textFilters) ? [...settings.textFilters] : [];
  renderFilters();

  addFilterButton.addEventListener('click', () => {
    filters.push({ replace: '', with: '' });
    renderFilters();
    // Put the cursor in the new row.
    filterList.querySelector('.filter-row:last-child .filter-from')?.focus();
  });

  // Show only a stored client ID. Do not show the built-in ID.
  const active = await getClientId();
  clientInput.value = active === getBuiltInClientId() ? '' : active;

  // Write on blur, not on each keystroke, because a change signs the user out.
  clientInput.addEventListener('change', async () => {
    await setClientId(clientInput.value);
    await renderAccount();
  });

  await renderAccount();
}

/** Show the account panel for the current session. */
async function renderAccount() {
  const session = await getSession();

  if (session.state === 'in') {
    const { username, blocked, rights } = session.account;
    const canEdit = !rights.length || rights.includes('edit');

    accountState.replaceChildren(
      note(`Signed in as ${username}.`, 'state-ok'),
      // A blocked account cannot edit. The API refuses the save.
      ...(blocked ? [note('This account is blocked. Wikidata will refuse its edits.', 'state-warn')] : []),
      ...(canEdit ? [] : [note('This account does not have the edit right.', 'state-warn')]),
      actions(
        button('Sign out', async () => {
          await signOut();
          await renderAccount();
        }),
        link('Manage permission on Wikimedia', GRANTS_URL),
      ),
      note('Sign-out removes the token from this computer. The permission stays until you withdraw it.'),
    );
    return;
  }

  if (session.state === 'unconfigured') {
    // This occurs only in a source version with an empty client ID.
    accountState.replaceChildren(
      note('This version has no OAuth client ID. Add a client ID under Advanced.', 'state-warn'),
    );
    return;
  }

  accountState.replaceChildren(
    note('You are not signed in. Items save with a temporary account.'),
    actions(button('Sign in to Wikidata', startSignIn, 'primary')),
  );
}

/** Run the sign-in and show the result. */
async function startSignIn() {
  accountState.replaceChildren(note('Waiting for Wikidata…'));

  try {
    await signIn();
  } catch (err) {
    await renderAccount();
    accountState.append(note(err.message, 'state-warn'));
    return;
  }

  await renderAccount();
}


/* ---------- text filters ---------- */

/** Show all filter rows. */
function renderFilters() {
  filterList.replaceChildren();

  for (const [index, filter] of filters.entries()) {
    filterList.append(filterRow(filter, index));
  }

  if (filters.length === 0) {
    filterList.append(note('No filters set.'));
  }

  // The storage has a size limit, so the number of filters has a limit.
  addFilterButton.disabled = filters.length >= MAX_FILTERS;
}

/**
 * Make one filter row: the text to replace, the new text, and a remove button.
 * @param {{replace: string, with: string}} filter
 * @param {number} index
 */
function filterRow(filter, index) {
  const row = document.createElement('div');
  row.className = 'filter-row';

  const from = filterInput('replace:', filter.replace, 'filter-from', (value) => {
    filters[index].replace = value;
    saveFilters();
  });

  const to = filterInput('with:', filter.with, 'filter-to', (value) => {
    filters[index].with = value;
    saveFilters();
  });

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'filter-remove';
  remove.textContent = '×';
  remove.title = 'Remove this filter';
  remove.setAttribute('aria-label', `Remove filter ${index + 1}`);
  remove.addEventListener('click', () => {
    filters.splice(index, 1);
    renderFilters();
    saveFilters();
  });

  row.append(from, to, remove);
  return row;
}

/**
 * Make one labeled field in a filter row.
 * @param {string} label
 * @param {string} value
 * @param {string} className
 * @param {(value: string) => void} onChange
 */
function filterInput(label, value, className, onChange) {
  const wrap = document.createElement('label');
  wrap.className = 'filter-field';

  const name = document.createElement('span');
  name.className = 'filter-label';
  name.textContent = label;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = `text-input ${className}`;
  input.value = value ?? '';
  input.autocomplete = 'off';
  input.spellcheck = false;
  // Write each keystroke, so that the saved filter is always complete.
  input.addEventListener('input', () => onChange(input.value));

  wrap.append(name, input);
  return wrap;
}

/** Write the filters. Remove rows that are not usable. */
function saveFilters() {
  setSetting('textFilters', cleanFilters(filters));
}

/* ---------- small builders ---------- */

function note(text, variant) {
  const p = document.createElement('p');
  p.className = variant ? `setting-note ${variant}` : 'setting-note';
  p.textContent = text;
  return p;
}

function actions(...children) {
  const div = document.createElement('div');
  div.className = 'account-actions';
  div.append(...children);
  return div;
}

function button(label, onClick, variant) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = variant ? `btn btn-${variant}` : 'btn';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function link(label, href) {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noreferrer';
  a.textContent = label;
  return a;
}
