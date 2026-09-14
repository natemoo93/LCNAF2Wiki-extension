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
import { findDuplicates } from '../core/wikidata.js';
import { getSettings } from '../core/settings.js';

/** Where the documentation link points. One constant, so it is one change. */
const DOCS_URL = 'https://github.com/natemoo93/LCNAF2Wiki-extension';

const form = document.getElementById('lookup');
const input = document.getElementById('id');
const button = document.getElementById('go');
const out = document.getElementById('out');
const optionsButton = document.getElementById('open-options');

/** Stops the fetch in operation when a second lookup starts. */
let inFlight = null;

init();

async function init() {
  input.focus();
  document.getElementById('docs').href = DOCS_URL;

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
  // Red outranks blue, which outranks green.
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

  // Build the URL at click time, so it includes the edits.
  const create = linkButton(
    'Create in Wikidata',
    () => newItemUrl(currentDraft(draft, inputs)),
    'primary',
  );

  actions.append(
    create,
    copyButton('Copy all', () => allFieldsText(draft, inputs)),
    copyButton('QuickStatements', () => toQuickStatements(currentDraft(draft, inputs))),
  );
  wrap.append(actions);

  // The check needs the setting on and an identifier to search for.
  if (settings.checkDuplicates && draft.lcnafId) {
    guardCreate(create, draft.lcnafId);
  }

  return wrap;
}

/**
 * Lock the create button until the duplicate check is complete. A duplicate
 * makes it grey; a click restores it. Refer to the README for the fail-open
 * rule.
 *
 * @param {HTMLButtonElement} button
 * @param {string} lcnafId
 */
async function guardCreate(button, lcnafId) {
  const label = button.textContent;
  button.disabled = true;

  const result = await findDuplicates(lcnafId);

  // No duplicate, or a check that did not complete. Fail open.
  if (result.status !== 'duplicate') {
    button.disabled = false;
    return;
  }

  // A duplicate. The title names the item that the search found.
  const found = result.items.map((i) => i.id).join(', ');
  button.disabled = false;
  button.textContent = 'Entry exists';
  button.className = 'copy copy-exists';
  button.title = found
    ? `Already in Wikidata as ${found} (P244 ${lcnafId}). Click to create one more item.`
    : `Already in Wikidata (P244 ${lcnafId}). Click to create one more item.`;

  // Capture phase and stopImmediatePropagation keep this before the handler
  // that opens Wikidata, so the first click only resets.
  const reset = (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    button.removeEventListener('click', reset, true);
    button.textContent = label;
    button.className = 'copy copy-primary';
    button.removeAttribute('title');
  };
  button.addEventListener('click', reset, true);
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

  btn.addEventListener('click', () => {
    const url = getUrl();
    // chrome.tabs is unavailable when the popup opens as a usual page.
    if (globalThis.chrome?.tabs?.create) chrome.tabs.create({ url });
    else window.open(url, '_blank', 'noreferrer');
  });

  return btn;
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

/** All the fields as lines with labels, to paste into a notes field. */
function allFieldsText(draft, inputs) {
  const d = currentDraft(draft, inputs);
  return [
    `Label: ${d.label}`,
    `Description: ${d.description}`,
    `Aliases: ${d.aliases.join('|')}`,
    `Language: ${d.lang}`,
    `LCNAF: ${d.lcnafId}`,
  ].join('\n');
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
