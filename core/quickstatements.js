/**
 * QuickStatements v1 output.
 *
 * The commands have tabs between the fields. They create a new item and set
 * the terms of the item. `LAST` is the item that the CREATE command before it
 * made.
 *
 * https://quickstatements.toolforge.org/#/help
 */

/** The Wikidata property for the Library of Congress authority ID. */
const P_LC_AUTHORITY = 'P244';

/**
 * Build a QuickStatements v1 batch for one draft.
 *
 * The output always contains the P244 statement. The statement records the
 * source of the item. Thus a subsequent reconciliation is an exact lookup and
 * not a name match.
 *
 * @param {import('./mapper.js').WikidataDraft} draft
 * @returns {string}
 */
export function toQuickStatements(draft) {
  const lines = ['CREATE'];
  const lang = draft.lang;

  if (draft.label) lines.push(`LAST\tL${lang}\t${quote(draft.label)}`);
  if (draft.description) lines.push(`LAST\tD${lang}\t${quote(draft.description)}`);

  for (const alias of draft.aliases) {
    lines.push(`LAST\tA${lang}\t${quote(alias)}`);
  }

  lines.push(`LAST\t${P_LC_AUTHORITY}\t${quote(draft.lcnafId)}`);

  return lines.join('\n');
}

/**
 * Make a QuickStatements string literal. Put double quotes at each end. Put an
 * escape character before each quote and each backslash in the value.
 * @param {string} value
 * @returns {string}
 */
function quote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
