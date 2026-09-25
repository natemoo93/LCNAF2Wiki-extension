/**
 * Make QuickStatements v1 output. Tabs separate the parts of each command.
 * `LAST` is the item from the CREATE command. https://quickstatements.toolforge.org/#/help
 */

/** The Wikidata property for the Library of Congress authority ID. */
const P_LC_AUTHORITY = 'P244';

/**
 * Make a QuickStatements v1 batch. Always include the P244 statement.
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
 * Make a QuickStatements string literal. Escape quotes and backslashes.
 * @param {string} value
 * @returns {string}
 */
function quote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
