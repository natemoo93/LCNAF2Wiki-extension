/**
 * Passive field extraction.
 *
 * This module reports the contents of the 100, 400 and 374 fields. It does no
 * name inversion, no singularization, and no label, alias or description
 * mapping. That transformation work is not in the scope of this module.
 *
 * This layer shows the cataloguer the shape of the record without changes. It
 * also identifies which subfields occur in practice. Write the rules that use
 * those subfields after this step.
 */

import { datafields, subfields, subfield, allSubfields, indicators, controlfield } from './marc.js';

/** The MARC tags that this prototype reads, with labels for the UI. */
export const TAGS = [
  { tag: '100', name: 'Personal name (authorized heading)' },
  { tag: '400', name: 'See-from tracing (variant name)' },
  { tag: '374', name: 'Occupation' },
];

/**
 * Extract the 100, 400 and 374 fields from a parsed record.
 *
 * @param {{id: string, doc: XMLDocument, source: string}} rec
 * @returns {{
 *   id: string,
 *   heading: string | undefined,
 *   groups: {tag: string, name: string, fields: object[], status: Status, messages: string[]}[],
 *   source: string
 * }}
 */
export function extractFields(rec) {
  const groups = TAGS.map(({ tag, name }) => {
    const fields = datafields(rec, tag).map((el, i) => describeField(el, tag, i));
    return { tag, name, fields, ...assess(tag, fields, rec) };
  });

  return {
    id: rec.id,
    heading: headingOf(rec),
    groups,
    source: rec.source,
  };
}

/**
 * The status of one tag group. The status sets the colour in the UI.
 *
 * - `present`   The field is present and is easy to read.      (green)
 * - `absent`    The field is not in this record.               (grey)
 * - `notable`   The field is present and contains more than a
 *               quick reading finds. It has more than one
 *               value, or a subfield with name data in
 *               addition to $a.                                (blue)
 * - `attention` The shape of the record is a problem. You
 *               cannot build an item from it.                  (red)
 *
 * Grey and blue keep the red status important.
 *
 * The `absent` status is not an error. Most LCNAF records correctly have no
 * 374 field and no 400 field. If you make that condition red, the usual
 * record looks defective.
 *
 * The `notable` status applies to usual records for which the cataloguer must
 * make a decision. Examples: which of four occupations to put in a
 * description, or whether to make a fuller form of the name into an alias. If
 * you give those records the same colour as an unusable record, persons learn
 * to ignore the red status.
 *
 * @typedef {'present' | 'absent' | 'notable' | 'attention'} Status
 */

/**
 * Set the status of a group and the messages that give the reason.
 * @param {string} tag
 * @param {object[]} fields
 * @param {{doc: XMLDocument}} rec
 * @returns {{status: Status, messages: string[]}}
 */
function assess(tag, fields, rec) {
  const messages = [];
  let attention = false;
  let notable = false;

  if (tag === '100') {
    if (fields.length === 0) {
      // Without an authorized personal-name heading you cannot build a
      // label. This is the only absence that is a problem.
      attention = true;
      if (datafields(rec, '110').length) {
        messages.push('Corporate name (110), not a personal name.');
      } else if (datafields(rec, '111').length) {
        messages.push('Meeting name (111), not a personal name.');
      } else {
        messages.push('No authorized personal-name heading found.');
      }
    } else {
      if (fields.length > 1) {
        attention = true;
        messages.push(`${fields.length} 100 fields.`);
      }
      for (const f of fields) {
        if (f.titleWords) {
          // The position of a title in direct order is a decision for a
          // person. Examples: "Sir John Smith", but "Irwin B. Rothschild
          // III".
          attention = true;
          messages.push(`$c "${f.titleWords}" — check placement in direct order.`);
        }
        if (f.fullerForm) {
          notable = true;
        }
      }
    }
  }

  if (tag === '374') {
    // More than one occupation can occur as a repeated $a in one field or as
    // separate fields. This is a serialisation detail. In the two conditions
    // the chip becomes blue and the MARC lines below show the terms. No
    // message is necessary.
    const terms = fields.flatMap((f) => f.values);
    if (terms.length > 1) {
      notable = true;
    }
  }

  if (tag === '400') {
    const withTitle = fields.some((f) => f.titleWords);
    const withFuller = fields.some((f) => f.fullerForm);
    if (withTitle || withFuller) {
      notable = true;
    }
  }

  if (fields.length === 0 && !attention) {
    messages.push(ABSENT_NOTE[tag] ?? 'Not present in this record.');
  }

  const status = attention
    ? 'attention'
    : fields.length === 0
      ? 'absent'
      : notable
        ? 'notable'
        : 'present';
  return { status, messages };
}

const ABSENT_NOTE = {
  374: 'No occupation.',
  400: 'No variant names.',
};

/**
 * One datafield, made flat for display.
 * @param {Element} el
 * @param {string} tag
 * @param {number} index the position in the fields that have this tag
 */
function describeField(el, tag, index) {
  return {
    tag,
    index,
    ...indicators(el),
    subfields: allSubfields(el),
    // The $a subfield repeats in one 374 field. One datafield can have more
    // than one occupation. Thus this is an array and not a scalar, also for
    // the 100 field.
    values: subfields(el, 'a'),
    // Accessors that the UI highlights. The value is undefined when the
    // subfield is absent.
    dates: subfield(el, 'd'),
    titleWords: subfield(el, 'c'),
    fullerForm: subfield(el, 'q'),
    vocabulary: subfield(el, '2'),
    /** The MARC single-line form. Example: `100 1# $a Sween, Joyce A. $d 1937-` */
    display: renderMarc(el, tag),
  };
}

/**
 * Show a datafield in the usual single-line MARC form that cataloguers read.
 * @param {Element} el
 * @param {string} tag
 * @returns {string}
 */
function renderMarc(el, tag) {
  const { ind1, ind2 } = indicators(el);
  const subs = allSubfields(el)
    .map((s) => `$${s.code} ${s.value}`)
    .join(' ');
  return `${tag} ${ind1}${ind2} ${subs}`;
}

/**
 * Get the authorized heading as a plain string for the panel title.
 * @param {{doc: XMLDocument}} rec
 */
function headingOf(rec) {
  const f = datafields(rec, '100')[0];
  return f ? subfield(f, 'a') : undefined;
}

/**
 * Normalize an LCNAF identifier. Remove all space characters in the identifier
 * and at each end. Thus "n  83053245" becomes "n83053245".
 *
 * LC prints identifiers with padding. The padding is not a part of the
 * identifier.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeId(raw) {
  return raw.replace(/\s+/g, '').trim();
}

/**
 * Get an LCNAF identifier from an id.loc.gov URL. Return undefined if the URL
 * has no identifier.
 * @param {string} url
 * @returns {string | undefined}
 */
export function idFromUrl(url) {
  const m = /\/authorities\/names\/([^/.?#]+)/.exec(url);
  return m ? m[1] : undefined;
}
