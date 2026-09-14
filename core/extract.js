/**
 * Passive extraction of the 100, 400 and 374 fields, with no transformation.
 * It shows the shape of the record. mapper.js does the mapping.
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
 * The status of one tag group, which sets its colour: present (green), absent
 * (grey), notable (blue), attention (red). Refer to the README.
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
      // Without a personal-name heading you cannot build a label.
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
          // The position of a title is a decision for a person.
          // Examples: "Sir John Smith", but "Irwin B. Rothschild III".
          attention = true;
          messages.push(`$c "${f.titleWords}": check placement in direct order.`);
        }
        if (f.fullerForm) {
          notable = true;
        }
      }
    }
  }

  if (tag === '374') {
    // Repeated $a or separate fields is a serialisation detail. The chip
    // becomes blue and the MARC lines show the terms, so no message is needed.
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
    // The $a subfield repeats in one 374 field, so this is always an array.
    values: subfields(el, 'a'),
    // Accessors the UI highlights. Undefined when the subfield is absent.
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
 * Normalize an LCNAF identifier. LC prints padding that is not part of the
 * identifier, so "n  83053245" becomes "n83053245".
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
