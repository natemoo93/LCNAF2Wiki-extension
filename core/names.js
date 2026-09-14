/**
 * Name inversion. LCNAF puts the surname first; Wikidata uses direct order.
 * The first indicator gives the shape: "1" is surname first, "0" is not.
 */

/** MARC punctuation at the end: a comma or a period used as a separator. */
const TRAILING_PUNCT = /[,.]+\s*$/;

/**
 * A name that cannot be inverted with confidence still gives a `direct` value
 * and a reason, so a person can correct it.
 *
 * @typedef {'high' | 'low'} Confidence
 * @typedef {{
 *   direct: string,
 *   surname?: string,
 *   forename?: string,
 *   confidence: Confidence,
 *   reason?: string
 * }} ParsedName
 */

/**
 * Invert one MARC name heading into direct order.
 *
 * @param {string} rawA the value of subfield $a
 * @param {{ind1?: string, titleWords?: string}} [opts]
 *   `titleWords` is $c, which is reported but never placed automatically.
 * @returns {ParsedName}
 */
export function invertName(rawA, opts = {}) {
  const cleaned = stripTrailingPunct(stripDates(rawA ?? ''));

  if (!cleaned) {
    return { direct: '', confidence: 'low', reason: 'Empty $a.' };
  }

  // An ind1 of "0" is already in direct order ("Aristotle").
  if (opts.ind1 === '0') {
    return { direct: cleaned, forename: cleaned, confidence: 'high' };
  }

  const commas = countCommas(cleaned);

  if (commas === 0) {
    // No comma to divide at. Usual for single names, but also the shape of
    // an incorrect heading, so report it when ind1 gives surname first.
    return {
      direct: cleaned,
      confidence: opts.ind1 === '1' ? 'low' : 'high',
      reason: opts.ind1 === '1' ? 'Marked surname-first but has no comma.' : undefined,
    };
  }

  const pivot = cleaned.indexOf(',');
  const surname = cleaned.slice(0, pivot).trim();
  const rest = cleaned.slice(pivot + 1).trim();
  const direct = collapseSpaces(`${rest} ${surname}`);

  if (commas > 1) {
    // A second comma usually shows an epithet, not a forename.
    // "Ludwig II, King of Bavaria" would invert incorrectly.
    return {
      direct,
      surname,
      forename: rest,
      confidence: 'low',
      reason: 'More than one comma. May be an epithet or qualifier, not a forename.',
    };
  }

  if (looksLikeEpithet(rest)) {
    // One comma, but the text after it is a title. Function words identify
    // this condition, because forenames do not contain them.
    return {
      direct,
      surname,
      forename: rest,
      confidence: 'low',
      reason: 'Text after the comma reads as a title or epithet, not a forename.',
    };
  }

  if (opts.titleWords) {
    // The position of $c is ambiguous: "Sir John Smith" but "Irwin B.
    // Rothschild III". Return the base name and set a flag.
    return {
      direct,
      surname,
      forename: rest,
      confidence: 'low',
      reason: `$c "${opts.titleWords}" is not placed automatically.`,
    };
  }

  return { direct, surname, forename: rest, confidence: 'high' };
}

/**
 * Remove a date range at the end of $a, as in "Smith, John, 1832-1901".
 * @param {string} raw
 * @returns {string}
 */
export function stripDates(raw) {
  return raw.replace(/,?\s*\b\d{4}\??\s*-\s*(\d{4}\??)?\s*$/, '');
}

/**
 * Remove the comma or period that MARC uses as a separator at the end.
 * @param {string} raw
 * @returns {string}
 */
export function stripTrailingPunct(raw) {
  // Remove the comma first. In "Rothschild, Irwin B.," the period before
  // it belongs to the initial.
  const s = raw.replace(/,\s*$/, '').trim();

  // An initial keeps its period. Do not change "Sween, Joyce A." to
  // "Joyce A".
  if (/(^|\s)\p{Lu}\.$/u.test(s)) return s;

  return s.replace(TRAILING_PUNCT, '').trim();
}

/**
 * Function words that occur in titles and epithets but not in forenames.
 */
const EPITHET_WORDS = /\b(of|de|del|della|di|van|von|the|d')\b/i;

/**
 * @param {string} rest the text after the first comma
 * @returns {boolean}
 */
function looksLikeEpithet(rest) {
  // "van" and "von" also occur in surnames, but not after the comma.
  return EPITHET_WORDS.test(rest);
}

/**
 * @param {string} s
 * @returns {number}
 */
function countCommas(s) {
  return (s.match(/,/g) ?? []).length;
}

/**
 * @param {string} s
 * @returns {string}
 */
function collapseSpaces(s) {
  return s.replace(/\s+/g, ' ').trim();
}
