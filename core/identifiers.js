/**
 * Get the external identifiers from the 024 field.
 * The VIAF number finds duplicates that have no P244.
 */

import { datafields, subfield, indicators } from './marc.js';

/**
 * The 024 source codes that this tool reads, with their Wikidata properties.
 * Ignore all other sources.
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
 * Read only `ind1="7"`, which means that $2 names the source.
 * @param {object} rec
 * @returns {ExternalId[]}
 */
export function extractIdentifiers(rec) {
  const out = [];
  const seen = new Set();

  for (const f of datafields(rec, '024')) {
    if (indicators(f).ind1 !== '7') continue;

    const source = (subfield(f, '2') ?? '').trim().toLowerCase();
    const value = (subfield(f, 'a') ?? '').trim();
    if (!source || !value) continue;

    const known = SOURCES[source];
    if (!known) continue;

    // A merged record can have the same identifier two times.
    const key = `${source}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ source, value, property: known.property });
  }

  return out;
}

/**
 * Get the VIAF cluster number, if the record has one.
 * @param {object} rec
 * @returns {string | undefined}
 */
export function viafId(rec) {
  const hit = extractIdentifiers(rec).find((i) => i.source === 'viaf');
  return hit ? normalizeViaf(hit.value) : undefined;
}

/**
 * Get the Wikidata item ID, if the record has one.
 * @param {object} rec
 * @returns {string | undefined}
 */
export function wikidataId(rec) {
  const hit = extractIdentifiers(rec).find((i) => i.source === 'wikidata');
  if (!hit) return undefined;

  // A QID is the letter Q and digits. Do not use other values.
  const value = hit.value.trim().toUpperCase();
  return /^Q\d+$/.test(value) ? value : undefined;
}

/**
 * Get the VIAF cluster number without an address.
 * Some records have a full address in $a.
 * @param {string} value
 * @returns {string | undefined}
 */
export function normalizeViaf(value) {
  const text = String(value ?? '').trim();
  if (!text) return undefined;

  // Use the last sequence of digits.
  const match = text.match(/(\d{1,22})\/?$/);
  return match ? match[1] : undefined;
}
