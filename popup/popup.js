/**
 * Popup controller.
 *
 * Each MARC tag shows as a chip with a colour code. Green is present. Grey is
 * absent. Red needs attention. Put the pointer on a chip or give the chip the
 * focus to show its detail. Click the chip to keep the detail open. You can
 * then read the detail and copy it.
 */

import { fetchRecord } from '../core/lcClient.js';
import { parseMarcXml } from '../core/marc.js';
import { extractFields, idFromUrl, normalizeId } from '../core/extract.js';
import { mapRecord } from '../core/mapper.js';
import { toQuickStatements } from '../core/quickstatements.js';
import { newItemUrl } from '../core/newitem.js';

/**
 * The destination of the "communicate with the project team" link. This is one
 * constant. Thus you can set the correct destination with a change to one
 * line. The destination can be a LibGuide, a wiki page or a contact form.
 */
const DOCS_URL = 'https://github.com/nulib/LCNAF2Wiki';

const form = document.getElementById('lookup');
const input = document.getElementById('id');
const button = document.getElementById('go');
const hint = document.getElementById('hint');
const out = document.getElementById('out');

/** Stops a fetch that is in operation when a second lookup starts. */
let inFlight = null;

init();

async function init() {
  input.focus();
  document.getElementById('docs').href = DOCS_URL;

  // If the user opened the popup on an LC authority page, fill in the
  // identifier from the URL and do the lookup immediately. Thus the usual
  // single-record task needs no keyboard input.
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const id = tab?.url ? idFromUrl(tab.url) : undefined;
    if (id) {
      input.value = id;
      showHint(`Detected ${id} on the current page.`);
      lookup(id);
    }
  } catch {
    // The chrome.tabs API can be unavailable. Example: the user opened the
    // popup as a usual page. This is not a serious failure. The user can type
    // an identifier.
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const id = normalizeId(input.value);
  if (!id) {
    input.focus();
    return;
  }
  // Show the normalized value. Thus the user sees that "n  8305" became
  // "n8305".
  input.value = id;
  hideHint();
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
    const { xml, url } = await fetchRecord(id, { signal: ctl.signal });
    if (ctl.signal.aborted) return;

    const rec = parseMarcXml(xml, id);
    renderRecord(extractFields(rec), mapRecord(rec), url);
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
 * @param {string} url
 */
function renderRecord(record, draft, url) {
  const frag = document.createDocumentFragment();

  const head = el('div', { class: 'record-head' });
  head.append(
    el('div', { class: 'name' }, record.heading ?? '(no 100 $a heading)'),
    el('div', { class: 'id' }, record.id),
  );
  frag.append(head);

  // Show the derived fields first. They are the function of the tool. The
  // MARC chips below are the data that supports them.
  const draftPanel = renderDraft(draft);
  frag.append(draftPanel);

  // Show one row of chips. Show one detail panel below the row. Keep the
  // detail in one location. Do not make the chips larger in the row. Thus the
  // row of chips does not move when the user moves the pointer across it.
  const row = el('div', { class: 'chips', role: 'list' });
  const detail = el('div', { class: 'detail', id: 'detail' });

  const controller = detailController(detail);

  for (const group of record.groups) {
    row.append(chip(group, controller));
  }

  frag.append(row, detail);

  const raw = el('details', { class: 'raw' });
  raw.append(el('summary', {}, 'Raw MARCXML'), el('pre', {}, record.source));
  frag.append(raw);

  const link = el('p', { class: 'hint' });
  link.append(el('a', { href: url, target: '_blank', rel: 'noreferrer' }, url));
  frag.append(link);

  out.replaceChildren(frag);

  // The fields are now in the document. Thus you can measure them and make
  // them large enough for their contents.
  draftPanel._sizeFields?.();

  // Open the most important group. Thus the record shows its condition and
  // the user does not have to find the chip with the flag. Red has priority
  // over blue. Blue has priority over green.
  const rank = ['attention', 'notable', 'present'];
  const opener = rank.map((s) => record.groups.find((g) => g.status === s)).find(Boolean);
  controller.pin(opener);
}

/**
 * The derived Wikidata fields. The user can edit them and copy them.
 *
 * The DOM holds the values. There is no separate model. Each field is a
 * textarea. Thus the copy buttons read the same text that the cataloguer
 * edits.
 *
 * @param {ReturnType<typeof mapRecord>} draft
 */
function renderDraft(draft) {
  const wrap = el('section', { class: 'draft' });

  // Show a warning that applies to one field next to that field. Show all
  // other warnings at the top of the panel.
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
    { key: 'description', name: 'Description', value: draft.description, hint: descriptionHint(draft) },
    { key: 'aliases', name: 'Aliases', value: draft.aliases.join('|') },
  ];

  const inputs = {};
  for (const f of fields) {
    const { row, field } = draftRow(f, byField[f.key] ?? []);
    inputs[f.key] = field;
    wrap.append(row);
  }

  // Set the size only after the panel is in the document. A textarea that is
  // not in the document gives a scrollHeight of 0. That value makes each field
  // a thin strip.
  wrap._sizeFields = () => Object.values(inputs).forEach(autoGrow);

  // The language is constant at this time. The user cannot edit it. Show the
  // language. Thus the default is visible.
  wrap.append(
    el(
      'div',
      { class: 'draft-row draft-lang' },
      el('span', { class: 'draft-name' }, 'Language'),
      el('span', { class: 'draft-static' }, draft.lang),
    ),
  );

  const actions = el('div', { class: 'draft-actions' });
  actions.append(
    // Build the URL when the user clicks. Thus the URL includes the edits
    // that the user made in the fields.
    linkButton('Create in Wikidata', () => newItemUrl(currentDraft(draft, inputs)), 'primary'),
    copyButton('Copy all', () => allFieldsText(draft, inputs)),
    copyButton('QuickStatements', () => toQuickStatements(currentDraft(draft, inputs))),
  );
  wrap.append(actions);

  return wrap;
}

/**
 * One field with a label. The user can edit the field and copy it.
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

  // Use a textarea and not an input. Aliases and long names go to the next
  // line. The field becomes larger. It does not scroll to the side.
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

  if (!spec.value) {
    row.append(el('p', { class: 'draft-empty' }, 'Nothing derived — add a value or leave blank.'));
  }

  return { row, field };
}

/** The source of the description. It gives the reason for an unusual value. */
function descriptionHint(draft) {
  if (draft.descriptionSource === 'dates') return `from dates (${draft.dateSource})`;
  if (draft.descriptionSource === 'occupation') return 'from 374';
  return undefined;
}

/**
 * A button that opens a URL in a new tab. The code builds the URL when the
 * user clicks.
 *
 * Special:NewItem only fills in the form. The cataloguer then examines the
 * form and pushes Create. Thus this button opens a tab. It writes no data.
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
    // The chrome.tabs API is unavailable when the user opens the popup as a
    // usual page.
    if (globalThis.chrome?.tabs?.create) chrome.tabs.create({ url });
    else window.open(url, '_blank', 'noreferrer');
  });

  return btn;
}

/**
 * A copy button. It reads its value when the user clicks. Thus it includes the
 * edits.
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
      // The clipboard can be unavailable. The user can select the text.
      flash(btn, 'Press Ctrl+C');
    }
  });

  return btn;
}

/** Change the label of a button for a short time to confirm the copy. */
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
 * Make a textarea large enough for its contents. Thus a scrollbar hides no
 * text.
 *
 * This function operates only when the element is in the document. The
 * scrollHeight is 0 when the element is not in the document. The CSS
 * min-height property keeps the field usable in the two conditions.
 */
function autoGrow(field) {
  field.style.height = 'auto';
  if (field.scrollHeight > 0) field.style.height = `${field.scrollHeight}px`;
}

/**
 * The open, preview and pin state of the detail panel. The chips use this
 * state together.
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
    /** Pointer or focus on a chip. Show the group. Do not change the pin. */
    preview: (group) => paint(group),
    /** Pointer off the chip or focus lost. Show the pinned group. */
    release: () => paint(pinned),
    /** Click. Pin this group. If the group is pinned, release the pin. */
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
      // A tooltip from the browser for a user who does not click.
      title: `${group.tag} — ${group.name}`,
    },
    el('span', { class: 'chip-tag' }, group.tag),
  );

  // The count is the primary data. "400 x3" gives more data than a green
  // dot.
  if (count > 1) node.append(el('span', { class: 'chip-count' }, `×${count}`));

  // Show a symbol and a colour. Thus the user can identify the three
  // "present" states without the colour.
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

function showHint(text) {
  hint.textContent = text;
  hint.hidden = false;
}

function hideHint() {
  hint.hidden = true;
}

/**
 * A minimal element builder. Give the text as children and add it with the
 * append method. Do not use innerHTML. The record data is not trusted input.
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
