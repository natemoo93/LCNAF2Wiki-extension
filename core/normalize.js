/**
 * LCSH occupation terms into Wikidata style: "Sociologists" to "sociologist".
 * The singulariser is a rules table, not a stemmer, because the list is small.
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
 * Words that end with -s and are already singular. Without this list,
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
  // Keep the punctuation at the end out of the morphology.
  const bare = word.replace(/[^\p{L}\p{M}'-]+$/u, '');
  const tail = word.slice(bare.length);
  const lower = bare.toLowerCase();

  if (IRREGULAR[lower]) return IRREGULAR[lower] + tail;
  if (INVARIANT.has(lower)) return bare + tail;

  // "-ss" (actress), "-us" (census) and "-is" (analysis) are not plural.
  if (/(ss|us|is)$/i.test(bare)) return bare + tail;

  if (/ies$/i.test(bare)) return bare.slice(0, -3) + 'y' + tail;
  if (/(ch|sh|x|z)es$/i.test(bare)) return bare.slice(0, -2) + tail;
  if (/s$/i.test(bare)) return bare.slice(0, -1) + tail;

  return bare + tail;
}

/**
 * Make the head noun of each coordinated phrase singular. "Motion picture
 * producers and directors" has two head nouns, not one.
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
 * Change one LCSH occupation term to Wikidata style. Subdivisions ("--") and
 * qualifiers stay, because interpreting them needs LCSH semantics.
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
 * True when a term keeps LCSH syntax a cataloguer may want to rewrite.
 * @param {string} raw
 * @returns {boolean}
 */
export function isAwkwardTerm(raw) {
  return /--|\(/.test(raw ?? '');
}

/**
 * Build a description from the occupation terms: lowercase, comma-separated.
 *
 * @param {string[]} terms
 * @returns {string}
 */
export function describeFromOccupations(terms) {
  const seen = new Set();
  const out = [];

  for (const t of terms ?? []) {
    const n = normalizeOccupation(t);
    // The same occupation can occur in more than one 374 field.
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out.join(', ');
}
