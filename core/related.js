/**
 * Read the 500 see-also tracings, which are identities related to this heading.
 * Report what the record states. Do not decide that two names are one person.
 */

import { datafields, indicators, subfield } from './marc.js';
import { invertName } from './names.js';

/**
 * 'stated' means that $i or $4 gives the relationship.
 * 'unclear' means that the 500 has no relationship designator.
 * @typedef {'stated' | 'unclear'} Confidence
 */

/**
 * `name` is in direct order for Wikidata.
 * `heading` is the inverted form from the record, for the MARC line.
 * @typedef {{
 *   name: string,
 *   heading: string,
 *   dates?: string,
 *   designator?: string,
 *   confidence: Confidence,
 *   sameIdentity?: boolean,
 *   note?: string
 * }} RelatedName
 */

/**
 * The $i designators that show that two headings are one person.
 * Report other designators with their own words.
 */
const SAME_IDENTITY = [
  'real identity',
  'alternate identity',
  'pseudonym',
  'alternative identity',
];

/**
 * Read the 500 tracings.
 * @param {object} rec
 * @returns {RelatedName[]}
 */
export function extractRelated(rec) {
  const out = [];

  for (const f of datafields(rec, '500')) {
    const heading = (subfield(f, 'a') ?? '').trim().replace(/,$/, '');
    if (!heading) continue;

    // Change the heading to direct order for Wikidata.
    // An ind1 of "0" is already in direct order.
    const parsed = invertName(subfield(f, 'a'), { ind1: rawInd1(f) });
    const name = parsed.direct || heading;

    // $i gives the relationship in words. $4 gives it as a URI or a code.
    const designator = (subfield(f, 'i') ?? '').trim().replace(/:$/, '');
    const hasCode = Boolean(subfield(f, '4'));

    const related = {
      name,
      heading,
      dates: subfield(f, 'd'),
      designator: designator || undefined,
      confidence: designator || hasCode ? 'stated' : 'unclear',
    };

    if (designator) {
      // Only a designator in SAME_IDENTITY shows one identity.
      related.sameIdentity = SAME_IDENTITY.includes(designator.toLowerCase());
    }

    out.push(related);
  }

  return out;
}

/**
 * Join the names in direct order with vertical bars, as in the aliases field.
 * @param {RelatedName[]} related
 * @returns {string}
 */
export function relatedAsText(related) {
  return related.map((r) => r.name).join('|');
}

/**
 * Get the first indicator as the record has it.
 * Change "#" to undefined for invertName.
 * @param {object} field
 * @returns {string | undefined}
 */
function rawInd1(field) {
  const v = indicators(field).ind1;
  return v === '#' ? undefined : v;
}
