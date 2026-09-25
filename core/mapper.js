/**
 * Make a Wikidata draft from a MARC record.
 * The draft has warnings that identify the fields to examine.
 */

import { datafields, subfields, subfield, indicators } from './marc.js';
import { invertName, looksRomanized } from './names.js';
import { describeFromOccupations, isAwkwardTerm, normalizeOccupation } from './normalize.js';
import { extractDates, formatDateParens, PRIVACY_BIRTH_YEAR } from './dates.js';
import { viafId, wikidataId } from './identifiers.js';
import { applyFilters } from './filters.js';

/** The default language. */
export const DEFAULT_LANG = 'en';

/**
 * @typedef {{code: string, field?: string, detail?: string}} Warning
 * @typedef {{
 *   lcnafId: string,
 *   viafId?: string,
 *   wikidataId?: string,
 *   lang: string,
 *   label: string,
 *   aliases: string[],
 *   excludedAliases: string[],
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
 * @param {{textFilters?: import('./filters.js').TextFilter[], excludeRomanized?: boolean}} [opts]
 * @returns {WikidataDraft}
 */
export function mapRecord(rec, opts = {}) {
  const warnings = [];
  // Apply the filters to the record text before inversion.
  // Thus one filter changes the label and the aliases.
  const filters = opts.textFilters ?? [];

  const label = buildLabel(rec, warnings, filters);
  const { aliases, excludedAliases } = buildAliases(rec, label, warnings, filters, opts.excludeRomanized);
  const { description, descriptionSource } = buildDescription(rec, warnings, filters);
  const { birth, death, source: dateSource } = extractDates(rec);

  return {
    lcnafId: rec.id,
    // These come from 024. Most records do not have them.
    viafId: viafId(rec),
    wikidataId: wikidataId(rec),
    lang: DEFAULT_LANG,
    label,
    aliases,
    excludedAliases,
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
 * @param {import('./filters.js').TextFilter[]} filters
 * @returns {string}
 */
function buildLabel(rec, warnings, filters = []) {
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
      detail: kind ? `The record is a ${kind}. It is not a personal name.` : 'The record has no 100 field.',
    });
    return '';
  }

  if (fields.length > 1) {
    warnings.push({ code: 'multiple-100', field: '100', detail: `The record has ${fields.length} 100 fields.` });
  }

  const f = fields[0];
  const parsed = invertName(applyFilters(subfield(f, 'a'), filters), {
    ind1: rawInd1(f),
    titleWords: applyFilters(subfield(f, 'c'), filters),
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
 * @param {import('./filters.js').TextFilter[]} filters
 * @param {boolean} excludeRomanized
 * @returns {{aliases: string[], excludedAliases: string[]}}
 */
function buildAliases(rec, label, warnings, filters = [], excludeRomanized = false) {
  const out = [];
  const excluded = [];
  const seen = new Set();
  let uncertain = 0;

  for (const f of datafields(rec, '400')) {
    // Do not use $w. It gives the relation, not name text.
    const raw = subfield(f, 'a');
    const filtered = applyFilters(raw, filters);
    const parsed = invertName(filtered, {
      ind1: rawInd1(f),
      titleWords: applyFilters(subfield(f, 'c'), filters),
    });

    const value = parsed.direct;
    if (!value) continue;

    // Exclude a romanization. Keep it if a text filter changed it, because the user wrote that filter.
    if (excludeRomanized && filtered === raw && looksRomanized(value)) {
      if (!excluded.includes(value)) excluded.push(value);
      continue;
    }

    if (parsed.confidence === 'low') uncertain++;

    // Skip an alias that is the same as the label.
    const key = value.toLowerCase();
    if (key === label.toLowerCase() || seen.has(key)) continue;

    seen.add(key);
    out.push(value);
  }

  if (uncertain) {
    warnings.push({
      code: 'alias-uncertain',
      field: '400$a',
      detail: `The tool cannot invert ${uncertain} variant name(s) with confidence.`,
    });
  }

  return { aliases: out, excludedAliases: excluded };
}

/**
 * Make the description from the occupations and the years in parentheses.
 * Each part is optional. Refer to the README for the privacy rule.
 * @param {object} rec
 * @param {Warning[]} warnings
 * @returns {{description: string, descriptionSource: 'occupation' | 'dates' | 'occupation+dates' | 'none'}}
 */
function buildDescription(rec, warnings, filters = []) {
  const terms = datafields(rec, '374')
    .flatMap((f) => subfields(f, 'a'))
    .map((t) => applyFilters(t, filters));
  const occupations = terms.length ? describeFromOccupations(terms) : '';

  if (terms.length) {
    const awkward = terms.filter(isAwkwardTerm);
    if (awkward.length) {
      warnings.push({
        code: 'lcsh-syntax',
        field: '374$a',
        detail: `These terms keep LCSH syntax: ${awkward.map(normalizeOccupation).join(', ')}.`,
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
        `The record has no occupation, and the person was born after ${PRIVACY_BIRTH_YEAR}. ` +
        'The tool does not show the birth year of a person who can be alive.',
    });
  } else {
    warnings.push({ code: 'no-description', detail: 'The record has no occupation and no dates.' });
  }

  return { description: '', descriptionSource: 'none' };
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

/**
 * Join the aliases with vertical bars for Wikidata.
 * @param {WikidataDraft} draft
 * @returns {string}
 */
export function aliasesAsText(draft) {
  return draft.aliases.join('|');
}
