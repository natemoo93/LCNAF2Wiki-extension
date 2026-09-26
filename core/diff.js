/**
 * Find what a draft adds to an item that exists. Only add values.
 * A field that the item has is 'same' or 'kept', never 'changed'.
 */

/**
 * @typedef {{
 *   key: string,
 *   name: string,
 *   status: 'add' | 'kept' | 'same' | 'withheld',
 *   value?: string,
 *   existing?: string,
 *   matchLang?: string
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

/** The statements that this tool writes, and their display names. */
const STATEMENT_NAMES = {
  P244: 'LCNAF ID (P244)',
  P31: 'Instance of (P31)',
};

/**
 * Compare a draft with an item that exists.
 * @param {import('./mapper.js').WikidataDraft} draft
 * @param {object} item the item as the REST API returns it
 * @param {Record<string, object[]>} statements the statements from the draft
 * @returns {ItemDiff}
 */
export function diffAgainstItem(draft, item, statements = {}) {
  const lang = draft.lang;
  const changes = [];

  const labels = {};
  const descriptions = {};
  const aliases = {};
  const newStatements = {};

  // Add a label or a description only if the item has none in this language.
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

  // Examine each alias. Skip an alias that the item has, and add the others.
  const existingAliases = item?.aliases?.[lang] ?? [];
  // Record if an alias list exists for this language.
  const hadAliases = existingAliases.length > 0;
  // Compare with the labels and aliases in all languages. Keep the language of each match.
  // A variant that the item has in a different language must not come back without a language.
  const known = knownNames(item, lang);

  const freshAliases = [];
  for (const alias of draft.aliases ?? []) {
    const matchLang = known.get(fold(alias));
    if (matchLang !== undefined) {
      changes.push({
        key: `alias:${alias}`,
        name: 'Alias',
        status: 'same',
        value: alias,
        ...(matchLang === lang ? {} : { matchLang }),
      });
      continue;
    }
    known.set(fold(alias), lang);
    freshAliases.push(alias);
    changes.push({ key: `alias:${alias}`, name: 'Alias', status: 'add', value: alias });
  }

  if (freshAliases.length) {
    // Keep only the new aliases. Do not write the existing list again.
    aliases[lang] = freshAliases;
  }

  // Add a statement only if the item does not have the property.
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
 * Make the JSON Patch that adds the diff to an item.
 * Each operation is an `add` into an empty place or onto the end of a list.
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

  // If no alias list exists, make the list in one operation.
  // If a list exists, add each alias to the end with the `/-` path.
  if (diff.freshAliases.length) {
    if (diff.hadAliases) {
      for (const alias of diff.freshAliases) {
        patch.push({ op: 'add', path: `/aliases/${lang}/-`, value: alias });
      }
    } else {
      patch.push({ op: 'add', path: `/aliases/${lang}`, value: [...diff.freshAliases] });
    }
  }

  // The item does not have these properties, so each `add` writes into an empty place.
  for (const [property, list] of Object.entries(diff.statements)) {
    patch.push({ op: 'add', path: `/statements/${property}`, value: list });
  }

  return {
    patch,
    comment: lcnafId ? `Added from LCNAF ${lcnafId} with LCNAF2Wiki` : 'Added with LCNAF2Wiki',
  };
}

/**
 * Remove the additions that the user withheld. Each key is a FieldChange key.
 * A withheld line gets the status 'withheld' and is not in the patch.
 * @param {ItemDiff} diff
 * @param {Set<string>} keys
 * @param {string} lang
 * @returns {ItemDiff}
 */
export function withhold(diff, keys, lang) {
  if (!keys.size) return diff;

  const freshAliases = diff.freshAliases.filter((a) => !keys.has(`alias:${a}`));
  const additions = diff.additions.map((c) =>
    c.status === 'add' && keys.has(c.key) ? { ...c, status: 'withheld' } : c,
  );

  return {
    ...diff,
    additions,
    labels: keys.has('label') ? {} : diff.labels,
    descriptions: keys.has('description') ? {} : diff.descriptions,
    aliases: freshAliases.length ? { [lang]: freshAliases } : {},
    freshAliases,
    statements: Object.fromEntries(Object.entries(diff.statements).filter(([p]) => !keys.has(p))),
    hasAdditions: additions.some((c) => c.status === 'add'),
  };
}

/**
 * Make a short summary of the additions for a button or a heading.
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
 * Get the value of a statement as text, to show and compare.
 * @param {object} statement
 * @returns {string}
 */
function readStatementValue(statement) {
  const content = statement?.value?.content;
  if (content == null) return '';
  // A time value is an object. All values from this tool are strings.
  return typeof content === 'string' ? content : (content.time ?? JSON.stringify(content));
}

/**
 * Map each normalized label and alias on the item to its language.
 * Put the draft language first, so that a match in that language has priority.
 * @param {object} item
 * @param {string} lang
 * @returns {Map<string, string>}
 */
function knownNames(item, lang) {
  const known = new Map();
  const add = (value, code) => {
    const key = fold(value);
    if (key && !known.has(key)) known.set(key, code);
  };

  // Wikidata refuses an alias that is the same as the label.
  add(item?.labels?.[lang], lang);
  for (const alias of item?.aliases?.[lang] ?? []) add(alias, lang);

  for (const [code, label] of Object.entries(item?.labels ?? {})) add(label, code);
  for (const [code, list] of Object.entries(item?.aliases ?? {})) {
    for (const alias of list ?? []) add(alias, code);
  }

  return known;
}

/** Normalize text for comparison. Ignore case and extra space characters. */
function fold(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Return true if two texts are the same after normalization. */
function sameText(a, b) {
  return fold(a) === fold(b);
}
