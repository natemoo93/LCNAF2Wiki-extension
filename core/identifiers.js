/**
 * External identifiers from the 024 field. Pure: a record in, identifiers out.
 *
 * LC records the identifiers of other authorities in 024 with the source
 * named in $2. VIAF is the useful one here, because VIAF clusters LC with
 * the national libraries, so an item made from a German or French record
 * carries the same VIAF number and no LCNAF id at all. That item is a
 * duplicate the P244 search cannot see.
 */

import { datafields, subfield, indicators } from './marc.js';

/**
 * The 024 source codes this tool reads, and the Wikidata property each one
 * matches. A source not listed here is ignored rather than guessed at.
 */
export const SOURCES = {
  viaf: { property: 'P214', name: 'VIAF' },
  wikidata: { property: null, name: 'Wikidata' },
};

/**
 * @typedef {{source: string, value: string, property: string | null}} ExternalId
 */

/**
 * Read the external identifiers from a record.
 * Only `ind1="7"` is read, which is the indicator that says "the source is
 * named in $2". Any other indicator means a different scheme.
 *
 * @param {object} rec
 * @returns {ExternalId[]}
 */
export function extractIdentifiers(rec) {
  const out = [];
  const seen = new Set();

  for (const f of datafields(rec, '024')) {
    // ind1 7 means "source specified in subfield $2".
    if (indicators(f).ind1 !== '7') continue;

    const source = (subfield(f, '2') ?? '').trim().toLowerCase();
    const value = (subfield(f, 'a') ?? '').trim();
    if (!source || !value) continue;

    const known = SOURCES[source];
    if (!known) continue;

    // The same identifier can be listed twice in a merged record.
    const key = `${source}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ source, value, property: known.property });
  }

  return out;
}

/**
 * The VIAF cluster number, if the record carries one.
 *
 * @param {object} rec
 * @returns {string | undefined}
 */
export function viafId(rec) {
  const hit = extractIdentifiers(rec).find((i) => i.source === 'viaf');
  return hit ? normalizeViaf(hit.value) : undefined;
}

/**
 * The Wikidata item id, if the record names one.
 * LC records this for a minority of headings, and it is the strongest
 * signal there is: the record itself says which item it belongs to.
 *
 * @param {object} rec
 * @returns {string | undefined}
 */
export function wikidataId(rec) {
  const hit = extractIdentifiers(rec).find((i) => i.source === 'wikidata');
  if (!hit) return undefined;

  // A QID is the letter Q and digits. Anything else is not usable.
  const value = hit.value.trim().toUpperCase();
  return /^Q\d+$/.test(value) ? value : undefined;
}

/**
 * A VIAF cluster number with any address around it removed.
 * LC writes the bare number in $a, but a record can carry a full address,
 * and a trailing slash would not match.
 *
 * @param {string} value
 * @returns {string | undefined}
 */
export function normalizeViaf(value) {
  const text = String(value ?? '').trim();
  if (!text) return undefined;

  // Take the last run of digits, so an address gives its number.
  const match = text.match(/(\d{1,22})\/?$/);
  return match ? match[1] : undefined;
}
