/**
 * Get the external identifiers from the 024 field and the class numbers from the 053 field.
 * The VIAF number finds duplicates that have no P244.
 */

import { datafields, subfield, indicators } from './marc.js';

/**
 * The 024 source codes that this tool reads, with their Wikidata properties.
 * Ignore all other sources.
 */
export const SOURCES = {
  viaf: { property: 'P214', name: 'VIAF' },
  isni: { property: 'P213', name: 'ISNI' },
  orcid: { property: 'P496', name: 'ORCID' },
  gnd: { property: 'P227', name: 'GND' },
  wikidata: { property: null, name: 'Wikidata' },
};

/** The Wikidata property for the Library of Congress Classification. */
export const P_LC_CLASSIFICATION = 'P1149';

/**
 * The format that Wikidata accepts for each property.
 * Do not send a value that does not match.
 */
const FORMATS = {
  P214: /^[1-9]\d(\d{0,7}|\d{17,20})$/,
  P213: /^0{7}\d{8}[\dX]$/,
  P496: /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/,
  P227: /^(1[01234]?\d{7}[\dX]|[47]\d{6}-\d|[1-9]\d{0,7}-[\dX]|3\d{7}[\dX])$/,
  P1149:
    /^[A-Z]{1,3}(\d+(\.\d+)?( *\.[A-Z]{0,3}\d+([ -]\.?[A-Z]{0,3}\d+)?)?( *\d+[a-z]*)?)?-?([A-Z]{1,3}(\d+(\.\d+)?( *\.[A-Z]{0,3}\d+([ -]\.?[A-Z]{0,3}\d+)?)?( *\d+[a-z]*)?)?)?$/,
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
 * Get the identifiers and class numbers to write as statements.
 * Each value has the form that Wikidata accepts. Other values are left out.
 * @param {object} rec
 * @returns {{property: string, value: string}[]}
 */
export function statementIds(rec) {
  const found = extractIdentifiers(rec)
    .filter((i) => i.property)
    .map((i) => ({ property: i.property, value: normalizeId(i.source, i.value) }));

  for (const f of datafields(rec, '053')) {
    const start = (subfield(f, 'a') ?? '').trim();
    const end = (subfield(f, 'b') ?? '').trim();
    // $b is the end of a range of class numbers.
    found.push({ property: P_LC_CLASSIFICATION, value: end ? `${start}-${end}` : start });
  }

  const out = [];
  const seen = new Set();
  for (const { property, value } of found) {
    const key = `${property}:${value}`;
    if (!value || seen.has(key) || !FORMATS[property].test(value)) continue;
    seen.add(key);
    out.push({ property, value });
  }
  return out;
}

/**
 * Change an 024 value to the form that Wikidata uses.
 * Remove an address before the value. Remove the spaces from an ISNI.
 * @param {string} source
 * @param {string} value
 * @returns {string}
 */
function normalizeId(source, value) {
  if (source === 'viaf') return normalizeViaf(value) ?? '';

  const bare = value.trim().replace(/^https?:\/\/\S+\//i, '');
  return source === 'isni' ? bare.replace(/\s+/g, '').toUpperCase() : bare;
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
