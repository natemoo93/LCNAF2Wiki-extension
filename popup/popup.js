/**
 * Control the popup. Each MARC tag shows as a color-coded chip.
 * A click on a chip opens or closes its detail.
 */

import { fetchRecord } from '../core/lcClient.js';
import { parseMarcXml } from '../core/marc.js';
import { extractFields, idFromUrl, normalizeId } from '../core/extract.js';
import { mapRecord } from '../core/mapper.js';
import { toQuickStatements } from '../core/quickstatements.js';
import { newItemUrl } from '../core/newitem.js';
import { findByViaf, findDuplicates } from '../core/wikidata.js';
import { findNameMatches } from '../core/namematch.js';
import { getSettings } from '../core/settings.js';
import { getAccessToken, getSession } from '../core/auth.js';
import { createItem, getItem, patchItem } from '../core/wikibase.js';
import { buildStatements, summarize } from '../core/statements.js';
import { buildAddPatch, diffAgainstItem, summarizeAdditions, withhold } from '../core/diff.js';

/** The address of the documentation link. */
const DOCS_URL = 'https://github.com/natemoo93/LCNAF2Wiki-extension';

const form = document.getElementById('lookup');
const input = document.getElementById('id');
const button = document.getElementById('go');
const out = document.getElementById('out');
const optionsButton = document.getElementById('open-options');
const accountBar = document.getElementById('account');

/**
 * The last session state that the popup read.
 * @type {import('../core/auth.js').SessionState}
 */
let session = { state: 'out' };

/** The fetch in progress. A second lookup stops it. */
let inFlight = null;

init();

async function init() {
  input.focus();
  document.getElementById('docs').href = DOCS_URL;

  // Read the session for the header. Sign-in is optional and is on the settings page.
  await refreshSession();

  // This button opens the settings page.
  optionsButton.addEventListener('click', () => {
    if (globalThis.chrome?.runtime?.openOptionsPage) chrome.runtime.openOptionsPage();
  });

  // On an LC authority page, get the identifier from the URL and look it up immediately.
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const id = tab?.url ? idFromUrl(tab.url) : undefined;
    if (id) {
      input.value = id;
      lookup(id);
    }
  } catch {
    // chrome.tabs is not available when the popup opens as a usual page.
    // The user can type an identifier.
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const id = normalizeId(input.value);
  if (!id) {
    input.focus();
    return;
  }
  // Show the normalized value, so that the user sees the change.
  input.value = id;
  lookup(id);
});

/**
 * Get, parse, extract, and show a record.
 * @param {string} id
 */
async function lookup(id) {
  inFlight?.abort();
  const ctl = new AbortController();
  inFlight = ctl;

  setBusy(true);
  renderLoading(id);

  try {
    const { xml } = await fetchRecord(id, { signal: ctl.signal });
    if (ctl.signal.aborted) return;

    const rec = parseMarcXml(xml, id);
    const settings = await getSettings();
    const draft = mapRecord(rec, {
      textFilters: settings.textFilters,
      excludeRomanized: settings.excludeRomanized,
    });
    renderRecord(extractFields(rec), draft, settings);
  } catch (err) {
    if (ctl.signal.aborted || err.name === 'AbortError') return;
    renderError(err);
  } finally {
    if (inFlight === ctl) {
      inFlight = null;
      setBusy(false);
    }
  }
}

/* ---------- the account ---------- */

/**
 * Read the session and show the account in the header.
 */
async function refreshSession() {
  try {
    session = await getSession();
  } catch {
    // If the session is not readable, use the signed-out state. This is the safe result.
    session = { state: 'out' };
  }
  renderAccount();
}

/** Show the signed-in name in the header. Show nothing when signed out. */
function renderAccount() {
  if (session.state !== 'in') {
    accountBar.hidden = true;
    accountBar.replaceChildren();
    return;
  }

  accountBar.hidden = false;
  accountBar.replaceChildren(
    el('span', { class: 'account-dot', title: 'Signed in' }),
    el('span', { class: 'account-name' }, session.account.username),
  );
}

/**
 * Show the draft again with the current session.
 */
let redrawDraft = () => {};

/* ---------- rendering ---------- */

function renderLoading(id) {
  out.replaceChildren(el('p', { class: 'loading' }, `Fetching ${id}…`));
}

/**
 * @param {ReturnType<typeof extractFields>} record
 * @param {ReturnType<typeof mapRecord>} draft
 * @param {typeof import('../core/settings.js').DEFAULTS} settings
 */
function renderRecord(record, draft, settings) {
  // A sign-in must unlock the save button without a new fetch.
  redrawDraft = () => renderRecord(record, draft, settings);

  const frag = document.createDocumentFragment();

  const head = el('div', { class: 'record-head' });
  head.append(el('div', { class: 'name' }, record.heading ?? '(no 100 $a heading)'));
  frag.append(head);

  // Show the derived fields first. The chips below show the source data.
  const draftPanel = renderDraft(draft, settings);
  frag.append(draftPanel);

  // Show one row of chips and one shared detail panel below it.
  // One detail panel keeps the chip row stable.
  const row = el('div', { class: 'chips', role: 'list' });
  const detail = el('div', { class: 'detail', id: 'detail' });

  const controller = detailController(detail);

  for (const group of record.groups) {
    row.append(chip(group, controller));
  }

  frag.append(row, detail);

  out.replaceChildren(frag);

  // The fields are in the document now, so measure them.
  draftPanel._sizeFields?.();

  // Open the most important group. Red is before yellow, and yellow is before green.
  const rank = ['attention', 'notable', 'present'];
  const opener = rank.map((s) => record.groups.find((g) => g.status === s)).find(Boolean);
  controller.pin(opener);
}

/**
 * Show the derived Wikidata fields. The user can edit and copy each field.
 * @param {ReturnType<typeof mapRecord>} draft
 */
function renderDraft(draft, settings = {}) {
  const wrap = el('section', { class: 'draft' });

  // Put a warning for one field next to that field. Put the other warnings at the top.
  const byField = {
    label: draft.warnings.filter((w) => w.code === 'label-uncertain' || w.code === 'multiple-100'),
    aliases: draft.warnings.filter((w) => w.code === 'alias-uncertain'),
    description: draft.warnings.filter((w) => w.code === 'lcsh-syntax'),
  };
  const general = draft.warnings.filter((w) => w.code === 'no-personal-name');

  for (const w of general) {
    wrap.append(el('p', { class: 'draft-warn' }, w.detail ?? w.code));
  }

  const fields = [
    { key: 'label', name: 'Label', value: draft.label },
    { key: 'description', name: 'Description', value: draft.description },
    { key: 'aliases', name: 'Aliases', value: draft.aliases.join('|') },
  ];

  const inputs = {};
  for (const f of fields) {
    const { row, field } = draftRow(f, byField[f.key] ?? []);
    inputs[f.key] = field;
    wrap.append(row);
  }

  // Set the field size after the panel is in the document.
  // A detached textarea gives a scrollHeight of 0.
  wrap._sizeFields = () => Object.values(inputs).forEach(autoGrow);

  const actions = el('div', { class: 'draft-actions' });

  // The area for the confirm step, the result, and errors.
  const stage = el('div', { class: 'stage' });

  // The API save does not need an account. The setting selects the save method.
  const savesByApi = settings.saveMethod !== 'form';

  const create = savesByApi
    ? button_('Create in Wikidata', () => {
        // Read the fields at the time of the click, so that the save includes edits.
        askToCreate(stage, currentDraft(draft, inputs), create);
      }, 'primary')
    : linkButton('Open prefilled form', () => newItemUrl(currentDraft(draft, inputs)), 'primary');

  // Tell the user which save method the button uses.
  create.title = savesByApi
    ? 'Save to Wikidata. You must confirm before the save.'
    : 'Open a prefilled form. Wikidata saves nothing until you press Create on the form.';

  actions.append(
    create,
    copyButton('QuickStatements', () => toQuickStatements(currentDraft(draft, inputs))),
  );
  wrap.append(actions, stage);

  // The check needs the setting on and an identifier.
  if (settings.checkDuplicates && draft.lcnafId) {
    guardCreate(create, draft, stage, () => currentDraft(draft, inputs));
  }

  return wrap;
}

/**
 * Get the access token. Return undefined when signed out.
 * An expired session must not stop a save.
 * @returns {Promise<string | undefined>}
 */
async function currentToken() {
  if (session.state !== 'in') return undefined;
  try {
    return await getAccessToken();
  } catch {
    // The session is expired. Save without a token. Do not lose the work.
    await refreshSession();
    return undefined;
  }
}

/**
 * Show the confirm step. Show all the data before the save.
 * @param {HTMLElement} stage
 * @param {import('../core/mapper.js').WikidataDraft} draft
 * @param {HTMLButtonElement} create
 */
function askToCreate(stage, draft, create) {
  showRefresh(create);
  const panel = el('div', { class: 'confirm' });
  panel.append(el('p', { class: 'confirm-title' }, 'Save this item to Wikidata?'));

  const rows = el('div', { class: 'confirm-rows' });
  for (const r of summarize(draft)) {
    rows.append(el('span', { class: 'confirm-key' }, r.name));
    rows.append(el('span', { class: 'confirm-value' }, r.value));
  }
  panel.append(rows);

  panel.append(
    el(
      'p',
      { class: 'confirm-who' },
      session.state === 'in'
        ? `Wikidata will show this edit as ${session.account.username}.`
        : 'Wikidata will show this edit with a temporary account.',
    ),
  );

  const go = button_('Create item', () => saveItem(stage, draft, create), 'primary');
  panel.append(
    el(
      'div',
      { class: 'confirm-actions' },
      go,
      button_('Cancel', () => closePanel(stage, create)),
    ),
  );

  stage.replaceChildren(panel);
}

/**
 * Change the button label to "Refresh" while its confirm panel is open.
 * Keep the first label, so that closePanel can restore it.
 * @param {HTMLButtonElement} button
 */
function showRefresh(button) {
  button.dataset.label ??= button.textContent;
  button.textContent = 'Refresh';
}

/**
 * Restore the label that the button had before its confirm panel opened.
 * @param {HTMLButtonElement} button
 */
function restoreLabel(button) {
  if (button.dataset.label) button.textContent = button.dataset.label;
  delete button.dataset.label;
}

/**
 * Close the confirm panel and restore the button label.
 * @param {HTMLElement} stage
 * @param {HTMLButtonElement} button
 */
function closePanel(stage, button) {
  stage.replaceChildren();
  restoreLabel(button);
}

/**
 * Write the item. Keep the draft on the screen, so that a failure does not lose edits.
 * @param {HTMLElement} stage
 * @param {import('../core/mapper.js').WikidataDraft} draft
 * @param {HTMLButtonElement} create
 */
async function saveItem(stage, draft, create) {
  stage.replaceChildren(el('p', { class: 'loading' }, 'Saving to Wikidata…'));
  create.disabled = true;

  try {
    // Use a token if one is available. Wikidata accepts the edit without a token.
    const token = await currentToken();
    const item = await createItem(draft, { accessToken: token });

    stage.replaceChildren(
      el(
        'div',
        { class: 'created' },
        'Created ',
        el('span', { class: 'created-id' }, item.id),
        '. ',
        linkLike('Open in Wikidata ↗', () => openUrl(item.url)),
      ),
    );

    // The item exists now. Disable the button to prevent a duplicate.
    delete create.dataset.label;
    create.textContent = 'Created ' + item.id;
    create.disabled = true;
  } catch (err) {
    create.disabled = false;
    restoreLabel(create);

    // The sign-in expired after the popup opened. Update the header.
    if (err.code === 'signed-out') {
      await refreshSession();
      stage.replaceChildren(
        el(
          'div',
          { class: 'save-error' },
          'Your sign-in is expired. Press Create again to save with a temporary account.',
        ),
      );
      return;
    }

    stage.replaceChildren(el('div', { class: 'save-error' }, err.message));
  }
}

/**
 * Lock the create button until the duplicate check is complete.
 * Refer to the README for the button states.
 * @param {HTMLButtonElement} button
 * @param {import('../core/mapper.js').WikidataDraft} draft
 */
async function guardCreate(button, draft, stage, readDraft) {
  const lcnafId = draft.lcnafId;
  button.disabled = true;

  const result = await findDuplicates(lcnafId);

  if (result.status === 'duplicate') {
    const [first] = result.items;
    // The item needs an address. Without an address, unlock the button.
    if (first?.url) {
      const found = result.items.map((i) => i.id).join(', ');
      await offerExisting(button, stage, readDraft, {
        itemId: first.id,
        url: first.url,
        title: found
          ? `Wikidata has this item as ${found}. P244 ${lcnafId} matches.`
          : `Wikidata has this item. P244 ${lcnafId} matches.`,
      });
      return;
    }
  }

  // There is no P244 match. Try the VIAF number next.
  // A VIAF match is an exact identifier match, so it is proof.
  if (result.status === 'none' && draft.viafId) {
    const byViaf = await findByViaf(draft.viafId);
    const [first] = byViaf.items;

    if (byViaf.status === 'duplicate' && first?.url) {
      const found = byViaf.items.map((i) => i.id).join(', ');
      await offerExisting(button, stage, readDraft, {
        itemId: first.id,
        url: first.url,
        title: `Wikidata has this item as ${found}. VIAF ${draft.viafId} matches.`,
      });
      return;
    }
  }

  // There is no identifier match. Try the name and the years next.
  if (result.status === 'none') {
    const byName = await findNameMatches(draft);
    const [first] = byName.items;

    if (byName.status === 'possible' && first?.url) {
      const found = byName.items.map((i) => i.id).join(', ');
      markFound(button, {
        label: 'Possible match ↗',
        variant: 'copy-possible',
        url: first.url,
        title: `${found} has this name and these years (${first.birth}–${first.death}), but no P244.`,
      });
      return;
    }
  }

  // The check found nothing or did not complete. Unlock the button.
  button.disabled = false;
}

/**
 * Read the item that exists and compare it with the record.
 * If the record has more data, offer to add it. If not, only open the item.
 * @param {HTMLButtonElement} button
 * @param {HTMLElement} stage
 * @param {() => import('../core/mapper.js').WikidataDraft} readDraft
 * @param {{itemId: string, url: string, title: string}} found
 */
async function offerExisting(button, stage, readDraft, found) {
  let item;
  try {
    item = await getItem(found.itemId);
  } catch {
    // The item is not readable, so do not compare. Only open the item.
    markFound(button, {
      label: 'Entry exists ↗',
      variant: 'copy-exists',
      url: found.url,
      title: found.title,
    });
    return;
  }

  const draft = readDraft();
  const diff = diffAgainstItem(draft, item, buildStatements(draft));

  if (!diff.hasAdditions) {
    markFound(button, {
      label: 'Entry exists ↗',
      variant: 'copy-exists',
      url: found.url,
      title: `${found.title} This record has nothing to add.`,
    });
    return;
  }

  // The record has data to add. Change the button to add the data.
  markAddable(button, stage, {
    ...found,
    diff,
    item,
    readDraft,
    lang: draft.lang,
    lcnafId: draft.lcnafId,
  });
}

/**
 * Change the button to add data to the item that exists.
 * @param {HTMLButtonElement} button
 * @param {HTMLElement} stage
 * @param {object} found
 */
function markAddable(button, stage, found) {
  button.disabled = false;
  button.textContent = `Add to ${found.itemId}`;
  button.className = 'copy copy-add';
  button.title = `${found.title} This record adds ${summarizeAdditions(found.diff)}.`;

  // Replace the node to remove the create handler. Thus the button cannot write a duplicate.
  const fresh = button.cloneNode(true);
  fresh.addEventListener('click', () => askToAdd(stage, found, fresh));
  button.replaceWith(fresh);
}

/**
 * Show the confirm step to add to an item.
 * Lines to write are green with a plus. Lines that the item has are grey.
 * @param {HTMLElement} stage
 * @param {object} found
 * @param {HTMLButtonElement} button
 */
function askToAdd(stage, found, button) {
  // Compare the current text fields with the item, so that the diff includes edits.
  const draft = found.readDraft();
  found = { ...found, diff: diffAgainstItem(draft, found.item, buildStatements(draft)) };
  showRefresh(button);

  const panel = el('div', { class: 'confirm' });
  panel.append(el('p', { class: 'confirm-title' }, `Add to ${found.itemId}?`));

  const diffBox = el('div', { class: 'diff' });

  // The keys of the additions that the user unchecked.
  const withheld = new Set();
  const onToggle = (key, keep) => {
    if (keep) withheld.delete(key);
    else withheld.add(key);
    go.disabled = !withhold(found.diff, withheld, found.lang).hasAdditions;
  };

  for (const change of found.diff.additions) {
    diffBox.append(diffLine(change, onToggle));
  }

  panel.append(diffBox);

  panel.append(
    el(
      'p',
      { class: 'confirm-who' },
      session.state === 'in'
        ? `Wikidata will show this edit as ${session.account.username}.`
        : 'Wikidata will show this edit with a temporary account.',
    ),
  );

  const go = button_(
    'Add',
    () => addToItem(stage, { ...found, diff: withhold(found.diff, withheld, found.lang) }, button),
    'primary',
  );
  go.disabled = !found.diff.hasAdditions;
  panel.append(
    el(
      'div',
      { class: 'confirm-actions' },
      go,
      linkLike('Open item ↗', () => openUrl(found.url)),
      button_('Cancel', () => closePanel(stage, button)),
    ),
  );

  stage.replaceChildren(panel);
}

/**
 * Make one line of the diff. An addition is green with a plus. Other lines are plain.
 * @param {import('../core/diff.js').FieldChange} change
 */
function diffLine(change, onToggle) {
  const added = change.status === 'add';

  const line = el('div', { class: added ? 'diff-line diff-add' : 'diff-line diff-keep' });

  line.append(el('span', { class: 'diff-mark' }, added ? '+' : ' '));
  line.append(el('span', { class: 'diff-name' }, change.name));
  // The value column always shows the value that the item will have.
  // For a kept line, that is the item's value, not the record's value.
  const kept = change.status === 'kept';
  const shown = kept ? change.existing || '(existing value)' : change.value;
  line.append(el('span', { class: 'diff-value' }, shown ?? ''));

  // Mark a line that the tool does not change. Show the language of a match in a different language.
  if (!added) {
    const note = change.matchLang ? `Unchanged (${change.matchLang})` : 'Unchanged';
    line.append(el('span', { class: 'diff-note' }, note));
    return line;
  }

  // An unchecked addition is withheld. It turns grey and is not in the patch.
  const box = el('input', {
    type: 'checkbox',
    class: 'diff-check',
    'aria-label': `Add ${change.name}: ${change.value ?? ''}`,
  });
  box.checked = true;

  box.addEventListener('change', () => {
    line.classList.toggle('diff-withheld', !box.checked);
    onToggle?.(change.key, box.checked);
  });

  line.append(box);
  return line;
}

/**
 * Write the additions. Do not remove data from the item.
 * @param {HTMLElement} stage
 * @param {object} found
 * @param {HTMLButtonElement} button
 */
async function addToItem(stage, found, button) {
  stage.replaceChildren(el('p', { class: 'loading' }, `Adding to ${found.itemId}…`));
  button.disabled = true;

  const body = buildAddPatch(found.diff, found.lang, found.lcnafId);

  try {
    const token = await currentToken();
    await patchItem(found.itemId, body.patch, {
      accessToken: token,
      comment: body.comment,
    });

    stage.replaceChildren(
      el(
        'div',
        { class: 'created' },
        `Added to ${found.itemId}. `,
        linkLike('Open in Wikidata ↗', () => openUrl(found.url)),
      ),
    );

    delete button.dataset.label;
    button.textContent = `Added to ${found.itemId}`;
    button.disabled = true;
  } catch (err) {
    button.disabled = false;
    restoreLabel(button);

    if (err.code === 'signed-out') {
      await refreshSession();
      stage.replaceChildren(
        el('div', { class: 'save-error' }, 'Your sign-in is expired. Press Add again to save with a temporary account.'),
      );
      return;
    }

    stage.replaceChildren(el('div', { class: 'save-error' }, err.message));
  }
}

/**
 * Change the create button to open an item that exists.
 * @param {HTMLButtonElement} button
 * @param {{label: string, variant: string, url: string, title: string}} found
 */
function markFound(button, found) {
  button.disabled = false;
  button.textContent = found.label;
  button.className = `copy ${found.variant}`;
  button.title = found.title;
  // linkButton reads this address instead of the create address, so only one tab opens.
  button.dataset.overrideUrl = found.url;

  // Replace the node to remove the save handler.
  // Thus the button can only open the item that exists.
  const fresh = button.cloneNode(true);
  fresh.addEventListener('click', () => openUrl(found.url));
  button.replaceWith(fresh);
}

/**
 * Make one labeled field that the user can edit and copy.
 * @param {{key: string, name: string, value: string, hint?: string}} spec
 * @param {{detail?: string, code: string}[]} warnings
 */
function draftRow(spec, warnings) {
  const row = el('div', { class: 'draft-row' });
  const flagged = warnings.length > 0;

  const head = el('div', { class: 'draft-head' });
  head.append(el('span', { class: 'draft-name' }, spec.name));
  if (spec.hint) head.append(el('span', { class: 'draft-hint' }, spec.hint));
  row.append(head);

  const line = el('div', { class: 'draft-line' });

  // Use a textarea, not an input, so that long names wrap.
  const field = el('textarea', {
    class: flagged ? 'draft-field is-flagged' : 'draft-field',
    rows: '1',
    spellcheck: 'false',
    'aria-label': spec.name,
  });
  field.value = spec.value ?? '';
  field.addEventListener('input', () => autoGrow(field));

  line.append(field, copyButton('Copy', () => field.value));
  row.append(line);

  for (const w of warnings) {
    row.append(el('p', { class: 'draft-warn' }, w.detail ?? w.code));
  }

  return { row, field };
}

/**
 * Make a button that runs a function in the popup.
 * @param {string} label
 * @param {() => void} onClick
 * @param {string} [variant]
 */
function button_(label, onClick, variant) {
  const btn = el(
    'button',
    { type: 'button', class: variant ? `copy copy-${variant}` : 'copy' },
    label,
  );
  btn.addEventListener('click', onClick);
  return btn;
}

/**
 * Make a button that looks like a link, for a secondary action.
 * @param {string} label
 * @param {() => void} onClick
 */
function linkLike(label, onClick) {
  const btn = el('button', { type: 'button', class: 'linklike' }, label);
  btn.addEventListener('click', onClick);
  return btn;
}

/**
 * Make a button that opens a URL in a new tab. Get the URL at the time of the click.
 * @param {string} label
 * @param {() => string} getUrl
 * @param {string} [variant]
 */
function linkButton(label, getUrl, variant) {
  const btn = el(
    'button',
    { type: 'button', class: variant ? `copy copy-${variant}` : 'copy' },
    label,
  );

  // An override URL opens a different page, for example an item that exists.
  btn.addEventListener('click', () => openUrl(btn.dataset.overrideUrl || getUrl()));

  return btn;
}

/**
 * Open an address in a new tab.
 * @param {string} url
 */
function openUrl(url) {
  // chrome.tabs is not available when the popup opens as a usual page.
  if (globalThis.chrome?.tabs?.create) chrome.tabs.create({ url });
  else window.open(url, '_blank', 'noreferrer');
}

/**
 * Make a copy button. Read the value at the time of the click, so that the copy includes edits.
 * @param {string} label
 * @param {() => string} getValue
 * @param {string} [variant]
 */
function copyButton(label, getValue, variant) {
  const btn = el(
    'button',
    { type: 'button', class: variant ? `copy copy-${variant}` : 'copy' },
    label,
  );

  btn.addEventListener('click', async () => {
    const text = getValue();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      flash(btn, 'Copied');
    } catch {
      // The clipboard can be blocked. The user can select and copy the text.
      flash(btn, 'Press Ctrl+C');
    }
  });

  return btn;
}

/** Change a button label for a short time to confirm the copy. */
function flash(btn, message) {
  const original = btn.textContent;
  btn.textContent = message;
  btn.classList.add('is-done');
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove('is-done');
  }, 1200);
}

/** Read the edited values into the shape of a draft. */
function currentDraft(draft, inputs) {
  return {
    ...draft,
    label: inputs.label.value.trim(),
    description: inputs.description.value.trim(),
    aliases: inputs.aliases.value
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

/**
 * Make a textarea tall enough for its content.
 * Use only after the element is in the document.
 */
function autoGrow(field) {
  field.style.height = 'auto';
  if (field.scrollHeight > 0) field.style.height = `${field.scrollHeight}px`;
}

/**
 * Control the pin state of the detail panel.
 * @param {HTMLElement} host
 */
function detailController(host) {
  /** @type {object | null} */
  let pinned = null;
  /** @type {Map<object, HTMLElement>} */
  const chips = new Map();

  function paint(group) {
    host.replaceChildren(group ? detailFor(group) : el('p', { class: 'detail-empty' }, ''));
    host.querySelectorAll('.draft-field').forEach(autoGrow);
    for (const [g, node] of chips) {
      node.setAttribute('aria-expanded', String(g === group));
      node.classList.toggle('is-open', g === group);
    }
  }

  return {
    register: (group, node) => chips.set(group, node),
    /** Click: pin this group, or unpin it if it is pinned. */
    pin: (group) => {
      pinned = pinned === group ? null : (group ?? null);
      paint(pinned);
    },
  };
}

/**
 * Make one tag chip with a color code.
 * @param {object} group
 * @param {ReturnType<typeof detailController>} controller
 */
function chip(group, controller) {
  const count = group.fields.length;

  const node = el(
    'button',
    {
      type: 'button',
      class: `chip chip-${group.status}`,
      role: 'listitem',
      'aria-expanded': 'false',
      'aria-controls': 'detail',
      // A browser tooltip for users who do not click.
      title: `${group.tag}: ${group.name}`,
    },
    el('span', { class: 'chip-tag' }, group.tag),
  );

  // Show the count if the tag repeats.
  if (count > 1) node.append(el('span', { class: 'chip-count' }, `×${count}`));

  // Add a symbol, so that users can identify the state without color.
  const mark = { attention: '!', notable: 'i' }[group.status];
  if (mark) node.append(el('span', { class: 'chip-mark' }, mark));

  node.addEventListener('click', () => controller.pin(group));

  controller.register(group, node);
  return node;
}

/**
 * Make the full body of one tag group.
 * @param {object} group
 */
function detailFor(group) {
  const wrap = el('div', { class: `detail-body detail-${group.status}` });

  if (group.copyText) {
    wrap.append(draftRow({ key: 'related', name: 'Related identities', value: group.copyText }, []).row);
  }

  wrap.append(
    el(
      'div',
      { class: 'detail-head' },
      el('span', { class: 'detail-tag' }, group.tag),
      el('span', { class: 'detail-name' }, group.name),
    ),
  );

  for (const m of group.messages) {
    wrap.append(el('p', { class: 'detail-msg' }, m));
  }

  for (const f of group.fields) {
    const line = el('div', { class: 'marc' });
    line.append(`${f.tag} ${f.ind1}${f.ind2} `);
    for (const s of f.subfields) {
      line.append(el('span', { class: 'sf' }, `$${s.code} `), `${s.value} `);
    }
    wrap.append(line);
  }

  return wrap;
}

/**
 * @param {Error & {code?: string}} err
 */
function renderError(err) {
  const msg =
    err.code === 'not-found'
      ? err.message
      : err.code === 'network'
        ? `${err.message} Make sure that the network connection operates.`
        : err.message || 'An error occurred.';
  out.replaceChildren(el('div', { class: 'error' }, msg));
}

/* ---------- helpers ---------- */

function setBusy(busy) {
  button.disabled = busy;
  button.textContent = busy ? 'Fetching…' : 'Fetch';
}

/**
 * Make an element. Append text. Do not use innerHTML, because record data is not trusted.
 * @param {string} tag
 * @param {Record<string, string>} attrs
 * @param {...(string | Node)} children
 */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}
