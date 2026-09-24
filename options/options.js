/**
 * Settings page controller. Each change is written immediately, and the
 * control itself is the confirmation.
 */

import { getSettings, setSetting } from '../core/settings.js';
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

/** Where the documentation link points. One constant, so it is one change. */
const DOCS_URL = 'https://github.com/natemoo93/LCNAF2Wiki-extension';

/** Where a user withdraws the permission they gave this extension. */
const GRANTS_URL = 'https://meta.wikimedia.org/wiki/Special:OAuthManageMyGrants';

const dupToggle = document.getElementById('check-duplicates');
const saveRadios = document.querySelectorAll('input[name="save-method"]');
const clientInput = document.getElementById('client-id');
const accountState = document.getElementById('account-state');
const redirectBox = document.getElementById('redirect-uri');

init();

async function init() {
  document.getElementById('docs').href = DOCS_URL;
  document.getElementById('register').href = REGISTER_URL;

  // The callback address is derived from the extension id, so it is shown
  // rather than typed. Registering the wrong one is the usual first failure.
  try {
    redirectBox.textContent = getRedirectUri();
  } catch {
    // An older browser with no identity API. The sign-in cannot run, and
    // the account panel says so.
  }

  const settings = await getSettings();

  dupToggle.checked = settings.checkDuplicates;
  dupToggle.addEventListener('change', () => {
    setSetting('checkDuplicates', dupToggle.checked);
  });

  for (const radio of saveRadios) {
    radio.checked = radio.value === settings.saveMethod;
    radio.addEventListener('change', () => {
      if (radio.checked) setSetting('saveMethod', radio.value);
    });
  }

  // The field holds the override only. Showing the built-in id here would
  // read as a value the user had typed, and clearing it would do nothing.
  const active = await getClientId();
  clientInput.value = active === getBuiltInClientId() ? '' : active;

  // Write on blur, not on every keystroke, because each write signs the user
  // out when the value changes.
  clientInput.addEventListener('change', async () => {
    await setClientId(clientInput.value);
    await renderAccount();
  });

  await renderAccount();
}

/** Paint the account panel from the session as it now is. */
async function renderAccount() {
  const session = await getSession();

  if (session.state === 'in') {
    const { username, blocked, rights } = session.account;
    const canEdit = !rights.length || rights.includes('edit');

    accountState.replaceChildren(
      note(`Signed in as ${username}.`, 'state-ok'),
      // A blocked account cannot edit, and the API would refuse the save.
      ...(blocked ? [note('This account is blocked. Edits will be refused.', 'state-warn')] : []),
      ...(canEdit ? [] : [note('This account has no edit right.', 'state-warn')]),
      actions(
        button('Sign out', async () => {
          await signOut();
          await renderAccount();
        }),
        link('Manage permission on Wikimedia', GRANTS_URL),
      ),
      note('Signing out forgets the token here. The permission stays until withdrawn.'),
    );
    return;
  }

  if (session.state === 'unconfigured') {
    // Only a source build with the constant still empty reaches this.
    accountState.replaceChildren(
      note('No OAuth client id in this build. Add one under Advanced.', 'state-warn'),
    );
    return;
  }

  accountState.replaceChildren(
    note('Not signed in. Items still save, credited to a temporary account.'),
    actions(button('Sign in to Wikidata', startSignIn, 'primary')),
  );
}

/** Run the sign-in and report the outcome in place. */
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
