/**
 * Occupation terms into Wikidata descriptions.
 *
 * The MARC 374 field has LCSH occupation terms. Those terms are plural and
 * start with a capital letter ("Sociologists"). Wikidata descriptions are
 * singular and lowercase. They have no period at the end ("sociologist").
 *
 * The singulariser is a table of rules with a list of exceptions. It is not a
 * general stemmer. The vocabulary is small. A stemmer fails without a message
 * and gives incorrect results ("physics" becomes "physic").
 */

/** Plurals that do not end with -s. */
const IRREGULAR = {
  people: 'person',
  children: 'child',
  women: 'woman',
  men: 'man',
  clergy: 'clergy',
};

/**
 * Words that end with -s and are already singular, or that have no singular
 * form in this context. Without this list, "personnel" stays correct, but
 * "physics" becomes "physic" and "news" becomes "new".
 */
const INVARIANT = new Set([
  'personnel',
  'physics',
  'economics',
  'politics',
  'mathematics',
  'statistics',
  'ethics',
  'linguistics',
  'news',
  'clergy',
  'police',
  'staff',
  'military',
]);

/**
 * Make one word singular. Keep the punctuation at the end of the word.
 * @param {string} word
 * @returns {string}
 */
function singularizeWord(word) {
  // Do not include the punctuation at the end (")", ",") in the
  // morphology.
  const bare = word.replace(/[^\p{L}\p{M}'-]+$/u, '');
  const tail = word.slice(bare.length);
  const lower = bare.toLowerCase();

  if (IRREGULAR[lower]) return IRREGULAR[lower] + tail;
  if (INVARIANT.has(lower)) return bare + tail;

  // The endings "-ss" (actress), "-us" (census) and "-is" (analysis) are not
  // plural markers.
  if (/(ss|us|is)$/i.test(bare)) return bare + tail;

  if (/ies$/i.test(bare)) return bare.slice(0, -3) + 'y' + tail;
  if (/(ch|sh|x|z)es$/i.test(bare)) return bare.slice(0, -2) + tail;
  if (/s$/i.test(bare)) return bare.slice(0, -1) + tail;

  return bare + tail;
}

/**
 * Make the head noun of each coordinated phrase singular.
 *
 * "Motion picture producers and directors" has two head nouns and not one. If
 * you change only the last word, "producers" stays plural.
 *
 * @param {string} phrase
 * @returns {string}
 */
function singularizePhrase(phrase) {
  return phrase
    .split(/(\s+and\s+|\s+&\s+)/i)
    .map((segment) => {
      if (/^\s*(and|&)\s*$/i.test(segment)) return segment;

      // The head of an English noun phrase is the last word.
      const parts = segment.split(/(\s+)/);
      for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i].trim()) {
          parts[i] = singularizeWord(parts[i]);
          break;
        }
      }
      return parts.join('');
    })
    .join('');
}

/**
 * Change one LCSH occupation term to the Wikidata description style.
 *
 * Keep the structure. Do not write it again. LCSH subdivisions ("--") and
 * qualifiers in parentheses stay. To interpret them, you must estimate the
 * LCSH semantics. The `isAwkwardTerm` function identifies the terms that a
 * person must examine.
 *
 * @param {string} raw e.g. "Deans (Education)"
 * @returns {string} e.g. "dean (education)"
 */
export function normalizeOccupation(raw) {
  const term = (raw ?? '').trim();
  if (!term) return '';

  const normalized = term
    // LCSH subdivision: each facet has its own head noun.
    .split('--')
    .map((facet) => {
      const qualified = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(facet.trim());
      if (qualified) {
        // "Deans (Education)": the head is before the parenthesis; the
        // qualifier is a scope note and stays as-is.
        return `${singularizePhrase(qualified[1])} (${qualified[2]})`;
      }
      return singularizePhrase(facet.trim());
    })
    .join('--');

  return normalized.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * True when a term keeps the LCSH syntax. The cataloguer can then write the
 * term again manually.
 * @param {string} raw
 * @returns {boolean}
 */
export function isAwkwardTerm(raw) {
  return /--|\(/.test(raw ?? '');
}

/**
 * Build a description from the occupation terms.
 *
 * The Wikidata style is: lowercase, commas between the terms, and no period at
 * the end.
 *
 * @param {string[]} terms
 * @returns {string}
 */
export function describeFromOccupations(terms) {
  const seen = new Set();
  const out = [];

  for (const t of terms ?? []) {
    const n = normalizeOccupation(t);
    // A record can give the same occupation in more than one 374 field.
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out.join(', ');
}
