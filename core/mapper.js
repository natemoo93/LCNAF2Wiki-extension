/**
 * MARC record to Wikidata draft. Pure: a record in, a draft out, no I/O.
 * The draft carries the warnings that say which fields to examine.
 */

import { datafields, subfields, subfield, indicators } from './marc.js';
import { invertName } from './names.js';
import { describeFromOccupations, isAwkwardTerm, normalizeOccupation } from './normalize.js';
import { extractDates, formatDateParens, PRIVACY_BIRTH_YEAR } from './dates.js';

/** The default language. One constant, so reading 040 $b later is one line. */
export const DEFAULT_LANG = 'en';

/**
 * @typedef {{code: string, field?: string, detail?: string}} Warning
 * @typedef {{
 *   lcnafId: string,
 *   lang: string,
 *   label: string,
 *   aliases: string[],
 *   description: string,
 *   birth?: object,
 *   death?: object,
 *   dateSource: string,
 *   descriptionSource: 'occupation' | 'dates' | 'occupation+dates' | 'none',
 *   warnings: Warning[],
 *   source: string
 * }} WikidataDraft
 */

/**
 * @param {{id: string, doc: XMLDocument, source: string}} rec
 * @returns {WikidataDraft}
 */
export function mapRecord(rec) {
  const warnings = [];

  const label = buildLabel(rec, warnings);
  const aliases = buildAliases(rec, label, warnings);
  const { description, descriptionSource } = buildDescription(rec, warnings);
  const { birth, death, source: dateSource } = extractDates(rec);

  return {
    lcnafId: rec.id,
    lang: DEFAULT_LANG,
    label,
    aliases,
    description,
    birth,
    death,
    dateSource,
    descriptionSource,
    warnings,
    source: rec.source,
  };
}

/**
 * Make the label from the 100 authorized heading, in direct order.
 * @param {object} rec
 * @param {Warning[]} warnings
 * @returns {string}
 */
function buildLabel(rec, warnings) {
  const fields = datafields(rec, '100');

  if (fields.length === 0) {
    const kind = datafields(rec, '110').length
      ? 'corporate name (110)'
      : datafields(rec, '111').length
        ? 'meeting name (111)'
        : undefined;
    warnings.push({
      code: 'no-personal-name',
      field: '100',
      detail: kind ? `Record is a ${kind}, not a personal name.` : 'No 100 field.',
    });
    return '';
  }

  if (fields.length > 1) {
    warnings.push({ code: 'multiple-100', field: '100', detail: `${fields.length} 100 fields.` });
  }

  const f = fields[0];
  const parsed = invertName(subfield(f, 'a'), {
    ind1: rawInd1(f),
    titleWords: subfield(f, 'c'),
  });

  if (parsed.confidence === 'low') {
    warnings.push({ code: 'label-uncertain', field: '100$a', detail: parsed.reason });
  }

  return parsed.direct;
}

/**
 * Make the aliases from the 400 variant names, inverted like the label.
 * @param {object} rec
 * @param {string} label
 * @param {Warning[]} warnings
 * @returns {string[]}
 */
function buildAliases(rec, label, warnings) {
  const out = [];
  const seen = new Set();
  let uncertain = 0;

  for (const f of datafields(rec, '400')) {
    // The $w subfield gives the relation, not name text. It is not used.
    const parsed = invertName(subfield(f, 'a'), {
      ind1: rawInd1(f),
      titleWords: subfield(f, 'c'),
    });

    const value = parsed.direct;
    if (!value) continue;
    if (parsed.confidence === 'low') uncertain++;

    // An alias equal to the label adds no data.
    const key = value.toLowerCase();
    if (key === label.toLowerCase() || seen.has(key)) continue;

    seen.add(key);
    out.push(value);
  }

  if (uncertain) {
    warnings.push({
      code: 'alias-uncertain',
      field: '400$a',
      detail: `${uncertain} variant name(s) could not be inverted with confidence.`,
    });
  }

  return out;
}

/**
 * Make the description: the occupations, then the years in parentheses.
 * Either part can be absent. Refer to the README for the privacy rule.
 *
 * @param {object} rec
 * @param {Warning[]} warnings
 * @returns {{description: string, descriptionSource: 'occupation' | 'dates' | 'occupation+dates' | 'none'}}
 */
function buildDescription(rec, warnings) {
  const terms = datafields(rec, '374').flatMap((f) => subfields(f, 'a'));
  const occupations = terms.length ? describeFromOccupations(terms) : '';

  if (terms.length) {
    const awkward = terms.filter(isAwkwardTerm);
    if (awkward.length) {
      warnings.push({
        code: 'lcsh-syntax',
        field: '374$a',
        detail: `Kept LCSH syntax in: ${awkward.map(normalizeOccupation).join(', ')}.`,
      });
    }
  }

  const { birth, death } = extractDates(rec);
  const years = formatDateParens(birth, death);

  // One space separates the two parts.
  const description = [occupations, years].filter(Boolean).join(' ');

  if (description) {
    return {
      description,
      descriptionSource: occupations && years ? 'occupation+dates' : occupations ? 'occupation' : 'dates',
    };
  }

  if (birth && !death) {
    warnings.push({
      code: 'no-description',
      detail:
        `No occupation, and the person was born after ${PRIVACY_BIRTH_YEAR}. ` +
        'The tool does not show the birth year of a person who can be alive.',
    });
  } else {
    warnings.push({ code: 'no-description', detail: 'No occupation and no dates.' });
  }

  return { description: '', descriptionSource: 'none' };
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

/**
 * The aliases with vertical bars between them, as Wikidata expects.
 * @param {WikidataDraft} draft
 * @returns {string}
 */
export function aliasesAsText(draft) {
  return draft.aliases.join('|');
}
