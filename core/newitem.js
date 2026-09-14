/**
 * Prefilled Special:NewItem links. The server renders the query parameters
 * into the form. Nothing is saved until the cataloguer presses Create.
 */

const NEW_ITEM_URL = 'https://www.wikidata.org/wiki/Special:NewItem';

/**
 * Build a prefilled Special:NewItem URL. Empty fields are omitted, so the
 * form shows its own placeholder text.
 *
 * @param {import('./mapper.js').WikidataDraft} draft
 * @returns {string}
 */
export function newItemUrl(draft) {
  const params = new URLSearchParams();
  params.set('lang', draft.lang);

  if (draft.label) params.set('label', draft.label);
  if (draft.description) params.set('description', draft.description);
  if (draft.aliases.length) params.set('aliases', draft.aliases.join('|'));

  return `${NEW_ITEM_URL}?${params}`;
}
