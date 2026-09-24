/**
 * Popup controller. Each MARC tag shows as a colour-coded chip.
 * Hover or focus previews the detail; a click pins it open.
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
import { buildAddPatch, diffAgainstItem, summarizeAdditions } from '../core/diff.js';

/** Where the documentation link points. One constant, so it is one change. */
const DOCS_URL = 'https://github.com/natemoo93/LCNAF2Wiki-extension';

const form = document.getElementById('lookup');
const input = document.getElementById('id');
const button = document.getElementById('go');
const out = document.getElementById('out');
const optionsButton = document.getElementById('open-options');
const accountBar = document.getElementById('account');

/**
 * The session as the popup last saw it. The draft panel reads this to decide
 * whether saving is possible, so it is kept beside the settings.
 * @type {import('../core/auth.js').SessionState}
 */
let session = { state: 'out' };

/** Stops the fetch in operation when a second lookup starts. */
let inFlight = null;

init();

async function init() {
  input.focus();
  document.getElementById('docs').href = DOCS_URL;

  // Read the session for the header. Sign-in is optional and lives in the
  // settings, so nothing here asks for it.
  await refreshSession();

  // The settings are on their own page in the extension manager. This button
  // opens that page.
  optionsButton.addEventListener('click', () => {
    if (globalThis.chrome?.runtime?.openOptionsPage) chrome.runtime.openOptionsPage();
  });

  // On an LC authority page, take the identifier from the URL and look it
  // up at once, so the usual task needs no keyboard input.
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const id = tab?.url ? idFromUrl(tab.url) : undefined;
    if (id) {
      input.value = id;
      lookup(id);
    }
  } catch {
    // chrome.tabs is unavailable when the popup opens as a usual page.
    // The user can still type an identifier.
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const id = normalizeId(input.value);
  if (!id) {
    input.focus();
    return;
  }
  // Show the normalized value, so the user sees what changed.
  input.value = id;
  lookup(id);
});

/**
 * Fetch, parse, extract, render.
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
    renderRecord(extractFields(rec), mapRecord(rec), settings);
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
 * Read the session and paint the header.
 * Signing in is optional, and the settings page is where it happens, so
 * this only reports who is signed in when somebody is.
 */
async function refreshSession() {
  try {
    session = await getSession();
  } catch {
    // An unreadable session reads as signed out, which fails safe.
    session = { state: 'out' };
  }
  renderAccount();
}

/** The signed-in name in the header, or nothing when signed out. */
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
 * Paint the draft again with the session as it now is.
 * Kept so a sign-out elsewhere can repaint the record on screen.
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
  // Signing in mid-record must unlock the save button without a refetch.
  redrawDraft = () => renderRecord(record, draft, settings);

  const frag = document.createDocumentFragment();

  const head = el('div', { class: 'record-head' });
  head.append(el('div', { class: 'name' }, record.heading ?? '(no 100 $a heading)'));
  frag.append(head);

  // The derived fields come first. The chips below are the evidence.
  const draftPanel = renderDraft(draft, settings);
  frag.append(draftPanel);

  // One row of chips, one shared detail panel below. Keeping the detail in
  // one place stops the chip row from reflowing.
  const row = el('div', { class: 'chips', role: 'list' });
  const detail = el('div', { class: 'detail', id: 'detail' });

  const controller = detailController(detail);

  for (const group of record.groups) {
    row.append(chip(group, controller));
  }

  frag.append(row, detail);

  out.replaceChildren(frag);

  // The fields are in the document now, so they can be measured.
  draftPanel._sizeFields?.();

  // Open the most significant group, so the record explains itself.
  // Red outranks yellow, which outranks green.
  const rank = ['attention', 'notable', 'present'];
  const opener = rank.map((s) => record.groups.find((g) => g.status === s)).find(Boolean);
  controller.pin(opener);
}

/**
 * The derived Wikidata fields, editable and copyable. The DOM holds the
 * values, so the copy buttons read exactly what the cataloguer edits.
 *
 * @param {ReturnType<typeof mapRecord>} draft
 */
function renderDraft(draft, settings = {}) {
  const wrap = el('section', { class: 'draft' });

  // A warning for one field goes next to it; the rest go at the top.
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

  // Size the fields only once the panel is in the document. A detached
  // textarea reports scrollHeight 0.
  wrap._sizeFields = () => Object.values(inputs).forEach(autoGrow);

  const actions = el('div', { class: 'draft-actions' });

  // Where the confirm step, the result and any failure are painted.
  const stage = el('div', { class: 'stage' });

  // Wikidata takes an item from a signed-out client too, so the API path
  // does not need an account. Signing in changes who the edit is credited
  // to, not whether it works. Only the setting chooses the path.
  const savesByApi = settings.saveMethod !== 'form';

  const create = savesByApi
    ? button_('Create in Wikidata', () => {
        // Read the fields at click time, so edits are carried through.
        askToCreate(stage, currentDraft(draft, inputs), create);
      }, 'primary')
    : linkButton('Open prefilled form', () => newItemUrl(currentDraft(draft, inputs)), 'primary');

  // Say which of the two the button does, because they save differently.
  create.title = savesByApi
    ? 'Save to Wikidata. A confirm step comes first.'
    : 'Open a prefilled form. Nothing saves until you press Create there.';

  actions.append(
    create,
    copyButton('QuickStatements', () => toQuickStatements(currentDraft(draft, inputs))),
  );
  wrap.append(actions, stage);

  // The check needs the setting on and an identifier to search for.
  if (settings.checkDuplicates && draft.lcnafId) {
    guardCreate(create, draft, stage, () => currentDraft(draft, inputs));
  }

  return wrap;
}

/**
 * The access token, or nothing when signed out.
 * A lapsed session must not stop a save, because the API takes the edit
 * without one.
 *
 * @returns {Promise<string | undefined>}
 */
async function currentToken() {
  if (session.state !== 'in') return undefined;
  try {
    return await getAccessToken();
  } catch {
    // The session lapsed. Save signed out rather than losing the work.
    await refreshSession();
    return undefined;
  }
}

/**
 * The confirm step. A saved item is public at once and cannot be taken back
 * with one click, so the whole write is shown before it happens.
 *
 * @param {HTMLElement} stage
 * @param {import('../core/mapper.js').WikidataDraft} draft
 * @param {HTMLButtonElement} create
 */
function askToCreate(stage, draft, create) {
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
      session.state === 'in' ? `Saving as ${session.account.username}.` : 'Saving anonymously.',
    ),
  );

  const go = button_('Create item', () => saveItem(stage, draft, create), 'primary');
  panel.append(
    el(
      'div',
      { class: 'confirm-actions' },
      go,
      button_('Cancel', () => stage.replaceChildren()),
    ),
  );

  stage.replaceChildren(panel);
  go.focus();
}

/**
 * Write the item. The draft stays on screen whatever happens, so a failure
 * loses nothing the cataloguer typed.
 *
 * @param {HTMLElement} stage
 * @param {import('../core/mapper.js').WikidataDraft} draft
 * @param {HTMLButtonElement} create
 */
async function saveItem(stage, draft, create) {
  stage.replaceChildren(el('p', { class: 'loading' }, 'Saving to Wikidata…'));
  create.disabled = true;

  try {
    // A token when one is available. Wikidata takes the edit either way,
    // so a signed-out save goes ahead rather than stopping the cataloguer.
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

    // The item now exists, so a second press would make a duplicate.
    create.textContent = 'Created ' + item.id;
    create.disabled = true;
  } catch (err) {
    create.disabled = false;

    // The sign-in lapsed between opening the popup and pressing save.
    // The header is repainted so it stops naming an account that is gone.
    if (err.code === 'signed-out') {
      await refreshSession();
      stage.replaceChildren(
        el(
          'div',
          { class: 'save-error' },
          'Sign-in expired. Press Create again to save anonymously.',
        ),
      );
      return;
    }

    stage.replaceChildren(el('div', { class: 'save-error' }, err.message));
  }
}

/**
 * Lock the create button until the duplicate check is complete. A P244 match
 * is proof and reads "Entry exists"; a name and date match is only evidence
 * and reads "Possible match". Refer to the README for the fail-open rule.
 *
 * @param {HTMLButtonElement} button
 * @param {import('../core/mapper.js').WikidataDraft} draft
 */
async function guardCreate(button, draft, stage, readDraft) {
  const lcnafId = draft.lcnafId;
  button.disabled = true;

  const result = await findDuplicates(lcnafId);

  if (result.status === 'duplicate') {
    const [first] = result.items;
    // An address is necessary to open the item, so without one, fail open.
    if (first?.url) {
      const found = result.items.map((i) => i.id).join(', ');
      await offerExisting(button, stage, readDraft, {
        itemId: first.id,
        url: first.url,
        title: found
          ? `Already in Wikidata as ${found}, matched on P244 ${lcnafId}.`
          : `Already in Wikidata, matched on P244 ${lcnafId}.`,
      });
      return;
    }
  }

  // No P244 match. The record can still name a VIAF cluster, and an item
  // built from another library's record carries that number and no P244.
  // A VIAF match is an exact identifier match, so it is proof, like P244.
  if (result.status === 'none' && draft.viafId) {
    const byViaf = await findByViaf(draft.viafId);
    const [first] = byViaf.items;

    if (byViaf.status === 'duplicate' && first?.url) {
      const found = byViaf.items.map((i) => i.id).join(', ');
      await offerExisting(button, stage, readDraft, {
        itemId: first.id,
        url: first.url,
        title: `Already in Wikidata as ${found}, matched on VIAF ${draft.viafId}.`,
      });
      return;
    }
  }

  // No identifier match. An item made without this tool can hold the same
  // person and no identifier at all, so try the name and the years next.
  if (result.status === 'none') {
    const byName = await findNameMatches(draft);
    const [first] = byName.items;

    if (byName.status === 'possible' && first?.url) {
      const found = byName.items.map((i) => i.id).join(', ');
      markFound(button, {
        label: 'Possible match ↗',
        variant: 'copy-possible',
        url: first.url,
        title: `${found} has this name and years (${first.birth}–${first.death}), but no P244.`,
      });
      return;
    }
  }

  // Nothing found, or a check that did not complete. Fail open.
  button.disabled = false;
}

/**
 * An item already exists. Read it, and see whether the record holds anything
 * it does not. With something to add the button offers to add it; with
 * nothing, it only opens the item.
 *
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
    // The item cannot be read, so there is nothing to compare. Fall back to
    // opening it, which is what the tool did before.
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
      title: `${found.title} Nothing in this record to add.`,
    });
    return;
  }

  // There is something to add. The button offers that instead of opening.
  markAddable(button, stage, {
    ...found,
    diff,
    lang: draft.lang,
    lcnafId: draft.lcnafId,
  });
}

/**
 * Point the button at adding to the item that exists.
 *
 * @param {HTMLButtonElement} button
 * @param {HTMLElement} stage
 * @param {object} found
 */
function markAddable(button, stage, found) {
  button.disabled = false;
  button.textContent = `Add to ${found.itemId}`;
  button.className = 'copy copy-add';
  button.title = `${found.title} This record adds ${summarizeAdditions(found.diff)}.`;

  // Replacing the node drops the create handler, so the button can no
  // longer write a duplicate item.
  const fresh = button.cloneNode(true);
  fresh.addEventListener('click', () => askToAdd(stage, found, fresh));
  button.replaceWith(fresh);
}

/**
 * The confirm step for adding to an item. Every line that will be written
 * is marked with a plus and a green ground, the way a diff reads. Lines
 * already on the item are shown grey, so it is clear nothing is replaced.
 *
 * @param {HTMLElement} stage
 * @param {object} found
 * @param {HTMLButtonElement} button
 */
function askToAdd(stage, found, button) {
  const panel = el('div', { class: 'confirm' });
  panel.append(el('p', { class: 'confirm-title' }, `Add to ${found.itemId}?`));

  const diffBox = el('div', { class: 'diff' });

  for (const change of found.diff.additions) {
    diffBox.append(diffLine(change));
  }

  panel.append(diffBox);

  panel.append(
    el(
      'p',
      { class: 'confirm-who' },
      session.state === 'in' ? `Saving as ${session.account.username}.` : 'Saving anonymously.',
    ),
  );

  const go = button_('Add', () => addToItem(stage, found, button), 'primary');
  panel.append(
    el(
      'div',
      { class: 'confirm-actions' },
      go,
      linkLike('Open item ↗', () => openUrl(found.url)),
      button_('Cancel', () => stage.replaceChildren()),
    ),
  );

  stage.replaceChildren(panel);
  go.focus();
}

/**
 * One line of the diff. An addition is green with a plus; anything else is
 * shown plainly, because it is not being touched.
 *
 * @param {import('../core/diff.js').FieldChange} change
 */
function diffLine(change) {
  const added = change.status === 'add';

  const line = el('div', { class: added ? 'diff-line diff-add' : 'diff-line diff-keep' });

  line.append(el('span', { class: 'diff-mark' }, added ? '+' : ' '));
  line.append(el('span', { class: 'diff-name' }, change.name));
  line.append(el('span', { class: 'diff-value' }, change.value ?? ''));

  // Say why a line is not being added, so the rule is visible.
  if (!added) {
    const why =
      change.status === 'same'
        ? 'already there'
        : `kept: ${change.existing || 'existing value'}`;
    line.append(el('span', { class: 'diff-note' }, why));
  }

  return line;
}

/**
 * Write the additions. The item keeps everything it had.
 *
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

    button.textContent = `Added to ${found.itemId}`;
    button.disabled = true;
  } catch (err) {
    button.disabled = false;

    if (err.code === 'signed-out') {
      await refreshSession();
      stage.replaceChildren(
        el('div', { class: 'save-error' }, 'Sign-in expired. Press Add again to save anonymously.'),
      );
      return;
    }

    stage.replaceChildren(el('div', { class: 'save-error' }, err.message));
  }
}

/**
 * Point the create button at an item that already exists.
 *
 * @param {HTMLButtonElement} button
 * @param {{label: string, variant: string, url: string, title: string}} found
 */
function markFound(button, found) {
  button.disabled = false;
  button.textContent = found.label;
  button.className = `copy ${found.variant}`;
  button.title = found.title;
  // The button now points at the item that exists. linkButton reads this
  // address instead of the create address, so only one tab opens.
  button.dataset.overrideUrl = found.url;

  // A save button carries its own click handler and would otherwise still
  // write a duplicate. Replacing the node drops every handler on it, so the
  // only thing the button can now do is open the item that exists.
  const fresh = button.cloneNode(true);
  fresh.addEventListener('click', () => openUrl(found.url));
  button.replaceWith(fresh);
}

/**
 * One labelled field, editable and copyable.
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

  // A textarea, not an input: long names wrap instead of scrolling sideways.
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
 * A plain button that runs a function. linkButton opens an address; this one
 * acts in the popup.
 *
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
 * A button styled as a link, for a secondary action.
 *
 * @param {string} label
 * @param {() => void} onClick
 */
function linkLike(label, onClick) {
  const btn = el('button', { type: 'button', class: 'linklike' }, label);
  btn.addEventListener('click', onClick);
  return btn;
}

/**
 * A button that opens a URL in a new tab, built at click time.
 * Special:NewItem only prefills the form, so this writes no data.
 *
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

  // An override sends the click somewhere else, such as to a Wikidata item
  // that already holds this identifier.
  btn.addEventListener('click', () => openUrl(btn.dataset.overrideUrl || getUrl()));

  return btn;
}

/**
 * Open an address in a new tab.
 * @param {string} url
 */
function openUrl(url) {
  // chrome.tabs is unavailable when the popup opens as a usual page.
  if (globalThis.chrome?.tabs?.create) chrome.tabs.create({ url });
  else window.open(url, '_blank', 'noreferrer');
}

/**
 * A copy button that reads its value at click time, so edits are respected.
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
      // The clipboard can be blocked. Selecting the text still works.
      flash(btn, 'Press Ctrl+C');
    }
  });

  return btn;
}

/** Briefly change a button label to confirm the copy. */
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
 * Grow a textarea to fit its content. Only meaningful once the element is in
 * the document, because a detached one reports scrollHeight 0.
 */
function autoGrow(field) {
  field.style.height = 'auto';
  if (field.scrollHeight > 0) field.style.height = `${field.scrollHeight}px`;
}

/**
 * Shared open, preview and pin state for the detail panel.
 * @param {HTMLElement} host
 */
function detailController(host) {
  /** @type {object | null} */
  let pinned = null;
  /** @type {Map<object, HTMLElement>} */
  const chips = new Map();

  function paint(group) {
    host.replaceChildren(group ? detailFor(group) : el('p', { class: 'detail-empty' }, ''));
    for (const [g, node] of chips) {
      node.setAttribute('aria-expanded', String(g === group));
      node.classList.toggle('is-open', g === group);
    }
  }

  return {
    register: (group, node) => chips.set(group, node),
    /** Hover or focus: show without changing the pin. */
    preview: (group) => paint(group),
    /** Pointer left or blur: fall back to the pinned group. */
    release: () => paint(pinned),
    /** Click: pin this group, or unpin it if already pinned. */
    pin: (group) => {
      pinned = pinned === group ? null : (group ?? null);
      paint(pinned);
    },
  };
}

/**
 * One tag chip with a colour code.
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
      // A browser tooltip, for anyone who never clicks.
      title: `${group.tag}: ${group.name}`,
    },
    el('span', { class: 'chip-tag' }, group.tag),
  );

  // The count is the at-a-glance payload.
  if (count > 1) node.append(el('span', { class: 'chip-count' }, `×${count}`));

  // A glyph as well as a colour, so the states stay distinct without hue.
  const mark = { attention: '!', notable: 'i' }[group.status];
  if (mark) node.append(el('span', { class: 'chip-mark' }, mark));

  node.addEventListener('mouseenter', () => controller.preview(group));
  node.addEventListener('mouseleave', () => controller.release());
  node.addEventListener('focus', () => controller.preview(group));
  node.addEventListener('blur', () => controller.release());
  node.addEventListener('click', () => controller.pin(group));

  controller.register(group, node);
  return node;
}

/**
 * The full body of one tag group.
 * @param {object} group
 */
function detailFor(group) {
  const wrap = el('div', { class: `detail-body detail-${group.status}` });

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
        ? `${err.message} Check your connection.`
        : err.message || 'Something went wrong.';
  out.replaceChildren(el('div', { class: 'error' }, msg));
}

/* ---------- helpers ---------- */

function setBusy(busy) {
  button.disabled = busy;
  button.textContent = busy ? 'Fetching…' : 'Fetch';
}

/**
 * A minimal element builder. Text is appended, never set via innerHTML,
 * because record data is untrusted.
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
