/**
 * MARC record to Wikidata draft.
 *
 * This module is pure. It takes a parsed record and gives a draft. It does no
 * input or output. The object that it returns has all the data that a
 * cataloguer needs to create the item. This includes the reasons to examine a
 * field before use.
 */

import { datafields, subfields, subfield } from './marc.js';
import { invertName } from './names.js';
import { describeFromOccupations, isAwkwardTerm, normalizeOccupation } from './normalize.js';
import { extractDates, formatDateRange } from './dates.js';

/**
 * The default language for the label, the alias and the description.
 *
 * This is one constant. Thus you can read the language from 040 $b later with
 * a change to one line. You do not have to find string literals in the code.
 */
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
 *   descriptionSource: 'occupation' | 'dates' | 'none',
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
    ind1: f.getAttribute('ind1') ?? undefined,
    titleWords: subfield(f, 'c'),
  });

  if (parsed.confidence === 'low') {
    warnings.push({ code: 'label-uncertain', field: '100$a', detail: parsed.reason });
  }

  return parsed.direct;
}

/**
 * Make the aliases from each 400 variant name. Invert them in the same way as
 * the label.
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
    // The $w subfield is a control subfield. It gives the relation. Example:
    // "nnea" for an earlier form of the name. It is not name text. It does
    // not go to the output.
    const parsed = invertName(subfield(f, 'a'), {
      ind1: f.getAttribute('ind1') ?? undefined,
      titleWords: subfield(f, 'c'),
    });

    const value = parsed.direct;
    if (!value) continue;
    if (parsed.confidence === 'low') uncertain++;

    // An alias that is the same as the label adds no data to the item.
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
 * Make the description from the 374 occupations. If there are no occupations,
 * use a date range.
 *
 * The date range applies only when a death date is present. A person who is
 * alive and has no occupation gets no description. Do not use only a birth
 * year.
 *
 * @param {object} rec
 * @param {Warning[]} warnings
 * @returns {{description: string, descriptionSource: 'occupation' | 'dates' | 'none'}}
 */
function buildDescription(rec, warnings) {
  const terms = datafields(rec, '374').flatMap((f) => subfields(f, 'a'));

  if (terms.length) {
    const awkward = terms.filter(isAwkwardTerm);
    if (awkward.length) {
      warnings.push({
        code: 'lcsh-syntax',
        field: '374$a',
        detail: `Kept LCSH syntax in: ${awkward.map(normalizeOccupation).join(', ')}.`,
      });
    }
    return { description: describeFromOccupations(terms), descriptionSource: 'occupation' };
  }

  const { birth, death } = extractDates(rec);
  const range = formatDateRange(birth, death);

  if (range) return { description: range, descriptionSource: 'dates' };

  if (birth && !death) {
    warnings.push({
      code: 'no-description',
      detail: 'No occupation, and a birth date alone is not used as a description.',
    });
  } else {
    warnings.push({ code: 'no-description', detail: 'No occupation and no dates.' });
  }

  return { description: '', descriptionSource: 'none' };
}

/**
 * Give the aliases in the format that Wikidata uses: one field with vertical
 * bars between the values.
 * @param {WikidataDraft} draft
 * @returns {string}
 */
export function aliasesAsText(draft) {
  return draft.aliases.join('|');
}
