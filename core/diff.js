/**
 * What a draft would add to an item that already exists. Pure: a draft and
 * an item in, a list of additions out.
 *
 * The tool only ever adds. A value already on the item is left as it is,
 * even when the record disagrees, because the record is one source among
 * several and the item can hold work this tool knows nothing about. A
 * cataloguer who wants to replace a value does it on Wikidata.
 *
 * Thus a field the item already fills is 'same' or 'kept', never 'changed'.
 */

/**
 * @typedef {{
 *   key: string,
 *   name: string,
 *   status: 'add' | 'kept' | 'same',
 *   value?: string,
 *   existing?: string
 * }} FieldChange
 *
 * @typedef {{
 *   additions: FieldChange[],
 *   labels: Record<string, string>,
 *   descriptions: Record<string, string>,
 *   aliases: Record<string, string[]>,
 *   freshAliases: string[],
 *   hadAliases: boolean,
 *   statements: Record<string, object[]>,
 *   hasAdditions: boolean
 * }} ItemDiff
 */

/** The statements this tool writes, and what to call them. */
const STATEMENT_NAMES = {
  P244: 'LCNAF ID (P244)',
  P31: 'Instance of (P31)',
};

/**
 * Compare a draft against an item that exists.
 *
 * @param {import('./mapper.js').WikidataDraft} draft
 * @param {object} item the item as the REST API returns it
 * @param {Record<string, object[]>} statements the statements the draft would write
 * @returns {ItemDiff}
 */
export function diffAgainstItem(draft, item, statements = {}) {
  const lang = draft.lang;
  const changes = [];

  const labels = {};
  const descriptions = {};
  const aliases = {};
  const newStatements = {};

  // A label or a description is one value per language, so it is added only
  // when the item has none. An item that has one keeps it.
  const existingLabel = item?.labels?.[lang] ?? '';
  if (draft.label && !existingLabel) {
    labels[lang] = draft.label;
    changes.push({ key: 'label', name: 'Label', status: 'add', value: draft.label });
  } else if (draft.label) {
    changes.push({
      key: 'label',
      name: 'Label',
      status: sameText(draft.label, existingLabel) ? 'same' : 'kept',
      value: draft.label,
      existing: existingLabel,
    });
  }

  const existingDescription = item?.descriptions?.[lang] ?? '';
  if (draft.description && !existingDescription) {
    descriptions[lang] = draft.description;
    changes.push({
      key: 'description',
      name: 'Description',
      status: 'add',
      value: draft.description,
    });
  } else if (draft.description) {
    changes.push({
      key: 'description',
      name: 'Description',
      status: sameText(draft.description, existingDescription) ? 'same' : 'kept',
      value: draft.description,
      existing: existingDescription,
    });
  }

  // Aliases are a list, so each one is judged on its own. An alias the item
  // already holds is skipped; the rest are added beside what is there.
  const existingAliases = item?.aliases?.[lang] ?? [];
  // Whether there is a list to append to. An absent language has none.
  const hadAliases = existingAliases.length > 0;
  const known = new Set(existingAliases.map(fold));
  // The label is not an alias of itself, and Wikidata refuses one that
  // matches the label.
  if (existingLabel) known.add(fold(existingLabel));

  const freshAliases = [];
  for (const alias of draft.aliases ?? []) {
    if (known.has(fold(alias))) {
      changes.push({ key: `alias:${alias}`, name: 'Alias', status: 'same', value: alias });
      continue;
    }
    known.add(fold(alias));
    freshAliases.push(alias);
    changes.push({ key: `alias:${alias}`, name: 'Alias', status: 'add', value: alias });
  }

  if (freshAliases.length) {
    // Only the new ones. Each is appended on its own, so the existing list
    // is never rewritten.
    aliases[lang] = freshAliases;
  }

  // A statement is added only when the property is absent. A property that
  // is present can hold a value this tool did not write, and replacing it
  // would remove somebody's work.
  for (const [property, list] of Object.entries(statements)) {
    const name = STATEMENT_NAMES[property] ?? property;
    const held = item?.statements?.[property] ?? [];
    const value = readStatementValue(list[0]);

    if (held.length === 0) {
      newStatements[property] = list;
      changes.push({ key: property, name, status: 'add', value });
      continue;
    }

    const existing = held.map(readStatementValue).filter(Boolean).join(', ');
    changes.push({
      key: property,
      name,
      status: held.some((s) => readStatementValue(s) === value) ? 'same' : 'kept',
      value,
      existing,
    });
  }

  const hasAdditions = changes.some((c) => c.status === 'add');

  return {
    additions: changes,
    labels,
    descriptions,
    aliases,
    freshAliases,
    hadAliases,
    statements: newStatements,
    hasAdditions,
  };
}

/**
 * The JSON Patch that adds everything in a diff to an item.
 *
 * Every operation is an `add`. A label or a description is added only where
 * the item has none, so `add` writes into an empty place and replaces
 * nothing. An alias appends with the `/-` path, which puts the value at the
 * end of the list and leaves the rest untouched. Thus the patch can only
 * grow the item, whatever else it holds.
 *
 * @param {ItemDiff} diff
 * @param {string} lang
 * @param {string} lcnafId
 * @returns {{patch: object[], comment: string} | undefined}
 */
export function buildAddPatch(diff, lang, lcnafId) {
  if (!diff.hasAdditions) return undefined;

  const patch = [];

  if (diff.labels[lang]) {
    patch.push({ op: 'add', path: `/labels/${lang}`, value: diff.labels[lang] });
  }

  if (diff.descriptions[lang]) {
    patch.push({ op: 'add', path: `/descriptions/${lang}`, value: diff.descriptions[lang] });
  }

  // Aliases. A language the item has no aliases in has no list to append
  // to, so the list is created in one operation. Where a list exists, each
  // alias appends with the `/-` path, which leaves the existing ones alone.
  // Rewriting the whole list would drop an alias added since the read.
  if (diff.freshAliases.length) {
    if (diff.hadAliases) {
      for (const alias of diff.freshAliases) {
        patch.push({ op: 'add', path: `/aliases/${lang}/-`, value: alias });
      }
    } else {
      patch.push({ op: 'add', path: `/aliases/${lang}`, value: [...diff.freshAliases] });
    }
  }

  // A statement list is added only for a property the item does not have,
  // so this writes into an empty place.
  for (const [property, list] of Object.entries(diff.statements)) {
    patch.push({ op: 'add', path: `/statements/${property}`, value: list });
  }

  return {
    patch,
    comment: lcnafId ? `Added from LCNAF ${lcnafId} with LCNAF2Wiki` : 'Added with LCNAF2Wiki',
  };
}

/**
 * A short count of what would be added, for a button or a heading.
 *
 * @param {ItemDiff} diff
 * @returns {string}
 */
export function summarizeAdditions(diff) {
  const added = diff.additions.filter((c) => c.status === 'add');
  if (added.length === 0) return 'Nothing to add';

  const aliases = added.filter((c) => c.key.startsWith('alias:')).length;
  const others = added.filter((c) => !c.key.startsWith('alias:')).map((c) => c.name.split(' (')[0]);

  const parts = [...others];
  if (aliases) parts.push(`${aliases} alias${aliases === 1 ? '' : 'es'}`);

  return parts.join(', ');
}

/**
 * The value of a statement as text, for showing and comparing.
 *
 * @param {object} statement
 * @returns {string}
 */
function readStatementValue(statement) {
  const content = statement?.value?.content;
  if (content == null) return '';
  // A time value is an object; everything this tool writes is a string.
  return typeof content === 'string' ? content : (content.time ?? JSON.stringify(content));
}

/** Compare two strings the way a cataloguer would: case and spacing aside. */
function fold(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** True when two pieces of text say the same thing. */
function sameText(a, b) {
  return fold(a) === fold(b);
}
