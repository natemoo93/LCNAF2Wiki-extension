/**
 * Wikidata "create a new item" links.
 *
 * Special:NewItem accepts lang, label, description and aliases as query
 * parameters. The server puts them in the form. Thus a link that is filled in
 * before use needs no script on the Wikidata side. Vertical bars separate the
 * aliases. The draft uses that format.
 *
 * The link only fills in the page. Wikidata saves no data until the cataloguer
 * examines the form and pushes Create.
 */

const NEW_ITEM_URL = 'https://www.wikidata.org/wiki/Special:NewItem';

/**
 * Build a Special:NewItem URL for a draft with the values filled in.
 *
 * Do not send empty fields. Omit them. Thus the form shows its own placeholder
 * text and not an empty box.
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
