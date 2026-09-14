/**
 * QuickStatements v1 output. Tab-separated commands, where `LAST` is the item
 * that the preceding CREATE made. https://quickstatements.toolforge.org/#/help
 */

/** The Wikidata property for the Library of Congress authority ID. */
const P_LC_AUTHORITY = 'P244';

/**
 * Build a QuickStatements v1 batch. The P244 statement is always emitted, so
 * a later reconciliation is an exact lookup and not a name match.
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
 * A QuickStatements string literal, with quotes and backslashes escaped.
 * @param {string} value
 * @returns {string}
 */
function quote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
