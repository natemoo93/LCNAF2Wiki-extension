/**
 * Invert names. LCNAF puts the surname first, and Wikidata uses direct order.
 * An ind1 of "1" is surname first. An ind1 of "0" is direct order.
 */

/** A comma: the ASCII comma or the Arabic comma (U+060C). LC uses both. */
const COMMA = /[,،]/;

/** A name in Chinese, Japanese, or Korean characters only, with spaces and name separators. */
const CJK_ONLY = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\s·・ー]+$/u;

/** A comma or a period that MARC puts at the end as a separator. */
const TRAILING_PUNCT = /[,،.]+\s*$/;

/**
 * A name with low confidence also has a `direct` value and a reason for a person to examine.
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
 * @param {string} rawA the value of subfield $a
 * @param {{ind1?: string, titleWords?: string}} [opts]
 *   `titleWords` is $c. The tool reports it but does not put it in position.
 * @returns {ParsedName}
 */
export function invertName(rawA, opts = {}) {
  const cleaned = stripTrailingPunct(stripDates(rawA ?? ''));

  if (!cleaned) {
    return { direct: '', confidence: 'low', reason: '$a is empty.' };
  }

  // An ind1 of "0" is already in direct order ("Aristotle").
  if (opts.ind1 === '0') {
    return { direct: cleaned, forename: cleaned, confidence: 'high' };
  }

  const commas = countCommas(cleaned);

  if (commas === 0) {
    // A single name has no comma. If ind1 shows surname first, report it.
    // Do not report a CJK name. It has no comma, and it is already in the correct order.
    const flag = opts.ind1 === '1' && !CJK_ONLY.test(cleaned);
    return {
      direct: cleaned,
      confidence: flag ? 'low' : 'high',
      reason: flag ? 'The indicator shows surname first, but the name has no comma.' : undefined,
    };
  }

  const pivot = cleaned.search(COMMA);
  const surname = cleaned.slice(0, pivot).trim();
  const rest = cleaned.slice(pivot + 1).trim();
  const direct = collapseSpaces(`${rest} ${surname}`);

  if (commas > 1) {
    // A second comma usually shows an epithet, not a forename.
    // Example: "Ludwig II, King of Bavaria".
    return {
      direct,
      surname,
      forename: rest,
      confidence: 'low',
      reason: 'The name has more than one comma. The text can be an epithet or a qualifier, not a forename.',
    };
  }

  if (looksLikeEpithet(rest)) {
    // The text after the comma is a title. Function words show this.
    return {
      direct,
      surname,
      forename: rest,
      confidence: 'low',
      reason: 'The text after the comma is possibly a title or epithet, not a forename.',
    };
  }

  if (opts.titleWords) {
    // The position of $c is not clear. Return the base name with low confidence.
    // Examples: "Sir John Smith" and "Irwin B. Rothschild III".
    return {
      direct,
      surname,
      forename: rest,
      confidence: 'low',
      reason: `Put $c "${opts.titleWords}" in position manually.`,
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
  return raw.replace(/[,،]?\s*\b\d{4}\??\s*-\s*(\d{4}\??)?\s*$/, '');
}

/**
 * Remove the comma or period that MARC uses as a separator at the end.
 * @param {string} raw
 * @returns {string}
 */
export function stripTrailingPunct(raw) {
  // Remove the comma first. In "Rothschild, Irwin B.," the period is part of the initial.
  const s = raw.replace(/[,،]\s*$/, '').trim();

  // Keep the period of an initial. Do not change "Sween, Joyce A." to "Joyce A".
  if (/(^|\s)\p{Lu}\.$/u.test(s)) return s;

  return s.replace(TRAILING_PUNCT, '').trim();
}

/** ALA-LC romanization marks: modifier letters, and macron, breve, dot, and tie accents. */
const ROMANIZATION_MARKS = /[\u02B9-\u02BC]|[\u0304\u0306\u0307\u0323\u0331\u0361\uFE20-\uFE23]/u;

/** Vietnamese marks. Vietnamese names use breve and dot below, but they are not romanizations. */
const VIETNAMESE_MARKS = /[\u0303\u0309\u031B\u0110\u0111]/u;

/**
 * Return true if a name looks like an ALA-LC romanization, such as "Mārk Tuwayn".
 * The name must have only Latin letters, so that a mark on a Cyrillic letter does not count.
 * @param {string} name
 * @returns {boolean}
 */
export function looksRomanized(name) {
  const text = String(name ?? '').normalize('NFD');
  // Ignore modifier letters such as ʻ. They are romanization marks, not letters of a script.
  const letters = (text.match(/\p{L}/gu) ?? []).filter((c) => !/\p{Lm}/u.test(c));
  if (!letters.length || !letters.every((c) => /\p{Script=Latin}/u.test(c))) return false;
  if (VIETNAMESE_MARKS.test(text)) return false;
  return ROMANIZATION_MARKS.test(text);
}

/** Function words that occur in titles and epithets but not in forenames. */
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
  return (s.match(new RegExp(COMMA, 'g')) ?? []).length;
}

/**
 * @param {string} s
 * @returns {string}
 */
function collapseSpaces(s) {
  return s.replace(/\s+/g, ' ').trim();
}
