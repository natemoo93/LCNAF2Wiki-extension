/**
 * The 500 see-also tracings: other identities related to this heading.
 * Pure: a record in, a list of related names out.
 *
 * A 500 points at another authority record. Sometimes that record is the
 * same human being under another name, as Lewis Carroll is Charles Dodgson;
 * sometimes it is a different person entirely, as the collaborator behind a
 * shared pseudonym. The field does not say which.
 *
 * This module reports what the record states and how far it can be trusted.
 * It never decides that two names are one person, because a wrong decision
 * there puts a false claim about a real person into a public database.
 */

import { datafields, indicators, subfield, subfields } from './marc.js';
import { invertName } from './names.js';

/**
 * How far a relationship can be trusted.
 *
 * 'stated'  the record names the relationship in $i or $4, under RDA. This
 *           is machine-readable and needs no guess.
 * 'unclear' a 500 with no relationship designator. It can be a pseudonym or
 *           a different person, and only a cataloguer can tell.
 *
 * @typedef {'stated' | 'unclear'} Confidence
 */

/**
 * `name` is in direct order, so it can be copied into Wikidata as it reads.
 * `heading` keeps the inverted form the record wrote, for the MARC line.
 *
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
 * The $i designators that say two headings are one person. RDA writes these
 * on the record, so they need no interpretation.
 *
 * The list is deliberately short. A designator not listed here is reported
 * with its own words and left to the cataloguer.
 */
const SAME_IDENTITY = [
  'real identity',
  'alternate identity',
  'pseudonym',
  'alternative identity',
];

/**
 * Read the 500 tracings.
 *
 * @param {object} rec
 * @returns {RelatedName[]}
 */
export function extractRelated(rec) {
  const out = [];

  for (const f of datafields(rec, '500')) {
    const heading = (subfield(f, 'a') ?? '').trim().replace(/,$/, '');
    if (!heading) continue;

    // The chip is read and copied into Wikidata, which uses direct order.
    // ind1 says whether the heading is inverted at all: "0" is a name that
    // is already direct, such as a one-word persona.
    const parsed = invertName(subfield(f, 'a'), { ind1: rawInd1(f) });
    const name = parsed.direct || heading;

    // $i carries the relationship in words, under RDA. $4 carries it as a
    // URI or a code. Either one makes the relationship explicit.
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
      // Only a designator this module knows is read as one identity.
      related.sameIdentity = SAME_IDENTITY.includes(designator.toLowerCase());
    }

    out.push(related);
  }

  return out;
}

/**
 * The prose note that explains a set of tracings, from 663.
 * LC writes the explanation there when the 500 display is suppressed, and
 * that prose is often the only thing that says whether the names are one
 * person. It is shown to the cataloguer, never parsed.
 *
 * @param {object} rec
 * @returns {string | undefined}
 */
export function relatedNote(rec) {
  const parts = [];

  for (const f of datafields(rec, '663')) {
    // $a is the explanation and $b the names it refers to. Without the
    // names the note says nothing useful, so both are read.
    const text = subfields(f, 'a').join(' ').trim();
    const names = subfields(f, 'b').map((n) => n.replace(/,$/, ''));

    const line = names.length ? `${text} ${names.join('; ')}` : text;
    if (line.trim()) parts.push(line.trim());
  }

  const out = parts.join(' ').replace(/\s+/g, ' ').trim();
  return out || undefined;
}

/**
 * The messages for the 500 chip: the names, and the 663 note if there is one.
 *
 * The chip names the identities and stops there. It does not say whether
 * they are the same person, because the record does not say either. The
 * MARC lines below the message show $i where a record states a relationship.
 *
 * @param {RelatedName[]} related
 * @param {string} [note] the 663 prose, when the record has one
 * @returns {string[]}
 */
export function describeRelated(related, note) {
  if (related.length === 0) return [];

  const messages = [`Related identities: ${list(related)}`];

  // The 663 prose is often the only thing that says whether these names are
  // one person, so it is shown as the record wrote it.
  if (note) messages.push(`663 note: ${note}`);

  return messages;
}

/** The names in a list, separated by commas. */
function list(related) {
  return related.map((r) => r.name).join(', ');
}

/**
 * The first indicator as written in the record. indicators() gives "#" for a
 * blank, but invertName needs undefined.
 *
 * @param {object} field
 * @returns {string | undefined}
 */
function rawInd1(field) {
  const v = indicators(field).ind1;
  return v === '#' ? undefined : v;
}
