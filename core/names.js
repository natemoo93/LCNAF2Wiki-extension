/**
 * Name inversion.
 *
 * LCNAF puts the surname first in a personal name ("Dyche, Grace Locke
 * Scripps"). Wikidata labels use direct order ("Grace Locke Scripps Dyche").
 *
 * The first indicator of the MARC 100 and 400 fields gives the shape of the
 * heading. Read the indicator. Do not estimate the shape. An ind1 of "1" is
 * surname first. An ind1 of "0" is a forename or a single name. Do not change
 * a name that has an ind1 of "0".
 */

/** MARC punctuation at the end: a comma or a period used as a separator. */
const TRAILING_PUNCT = /[,.]+\s*$/;

/**
 * A name that the module cannot invert with confidence gives a `direct` value
 * and a reason. The caller shows the value. A person then corrects it.
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
 *   `ind1` is the first indicator of the datafield. `titleWords` is $c. The
 *   module reports $c but does not put it in position. Refer to the notes
 *   below.
 * @returns {ParsedName}
 */
export function invertName(rawA, opts = {}) {
  const cleaned = stripTrailingPunct(stripDates(rawA ?? ''));

  if (!cleaned) {
    return { direct: '', confidence: 'low', reason: 'Empty $a.' };
  }

  // An ind1 of "0" identifies a forename or a single name. That name is
  // already in direct order ("Aristotle"). Do not invert it.
  if (opts.ind1 === '0') {
    return { direct: cleaned, forename: cleaned, confidence: 'high' };
  }

  const commas = countCommas(cleaned);

  if (commas === 0) {
    // There is no comma to divide the name at. This is usual for single
    // names. An incorrectly formed heading also has this shape. Thus report
    // the condition when the indicator gives surname first. Do not accept it
    // without a message.
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
    // "Ludwig II, King of Bavaria" inverts to "King of Bavaria Ludwig II".
    // That result is incorrect. A second comma usually shows an epithet or an
    // added qualifier and not a forename. A person must examine this
    // condition.
    return {
      direct,
      surname,
      forename: rest,
      confidence: 'low',
      reason: 'More than one comma — may be an epithet or qualifier, not a forename.',
    };
  }

  if (looksLikeEpithet(rest)) {
    // "Ludwig II, King of Bavaria" has one comma. But the text after the
    // comma is a title and not a forename. Inversion gives "King of Bavaria
    // Ludwig II". Function words identify this condition. Correct forenames
    // do not contain function words.
    return {
      direct,
      surname,
      forename: rest,
      confidence: 'low',
      reason: 'Text after the comma reads as a title or epithet, not a forename.',
    };
  }

  if (opts.titleWords) {
    // The position of $c is ambiguous. "Sir" goes before the name ("Sir John
    // Smith"). "III" and "Jr." go after the name ("Irwin B. Rothschild III").
    // An estimate is incorrect 50 percent of the time. Thus return the base
    // name and set a flag.
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
 * Remove a date range at the end of $a. Some headings put the date range in $a
 * and not in $d. Example: "Smith, John, 1832-1901".
 * @param {string} raw
 * @returns {string}
 */
export function stripDates(raw) {
  return raw.replace(/,?\s*\b\d{4}\??\s*-\s*(\d{4}\??)?\s*$/, '');
}

/**
 * Remove the comma or the period that MARC uses as a separator at the end of
 * the value. 53 of the 92 sample records need this step before inversion.
 * @param {string} raw
 * @returns {string}
 */
export function stripTrailingPunct(raw) {
  // Remove a comma at the end first. "Rothschild, Irwin B.," ends with a
  // comma. But the period before the comma is a part of the initial.
  const s = raw.replace(/,\s*$/, '').trim();

  // An initial keeps its period. Do not change "Sween, Joyce A." to
  // "Joyce A".
  if (/(^|\s)\p{Lu}\.$/u.test(s)) return s;

  return s.replace(TRAILING_PUNCT, '').trim();
}

/**
 * Function words that occur in titles and epithets ("King of Bavaria", "Duke
 * of Wellington") but not in forenames. If one of these words occurs after the
 * comma, the heading is not a usual surname and forename pair.
 */
const EPITHET_WORDS = /\b(of|de|del|della|di|van|von|the|d')\b/i;

/**
 * @param {string} rest the text after the first comma
 * @returns {boolean}
 */
function looksLikeEpithet(rest) {
  // The words "van" and "von" also occur in surnames. But this function
  // examines only the text after the comma. A surname particle does not occur
  // in that position.
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
