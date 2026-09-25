/**
 * Make prefilled Special:NewItem links. The server puts the query parameters into the form.
 * Wikidata saves nothing until the user presses Create.
 */

const NEW_ITEM_URL = 'https://www.wikidata.org/wiki/Special:NewItem';

/**
 * Make a prefilled Special:NewItem URL. Omit empty fields.
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
