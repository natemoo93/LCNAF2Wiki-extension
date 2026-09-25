/**
 * Change LCSH occupation terms to Wikidata style. Example: "Sociologists" to "sociologist".
 * The singular forms come from a table of rules, not a stemmer.
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
 * Words that end with -s and are singular.
 * Without this list, "physics" becomes "physic".
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
  // Do not change the punctuation at the end.
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
 * Make the head noun of each coordinated phrase singular.
 * Example: "Motion picture producers and directors" has two head nouns.
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
 * Change one LCSH occupation term to Wikidata style.
 * Do not change subdivisions ("--") or qualifiers.
 * @param {string} raw e.g. "Deans (Education)"
 * @returns {string} e.g. "dean (education)"
 */
export function normalizeOccupation(raw) {
  const term = (raw ?? '').trim();
  if (!term) return '';

  const normalized = term
    // Each LCSH subdivision has its own head noun.
    .split('--')
    .map((facet) => {
      const qualified = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(facet.trim());
      if (qualified) {
        // In "Deans (Education)", the head is before the parenthesis.
        // Do not change the qualifier.
        return `${singularizePhrase(qualified[1])} (${qualified[2]})`;
      }
      return singularizePhrase(facet.trim());
    })
    .join('--');

  return normalized.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Return true if a term has LCSH syntax that a person can rewrite.
 * @param {string} raw
 * @returns {boolean}
 */
export function isAwkwardTerm(raw) {
  return /--|\(/.test(raw ?? '');
}

/**
 * Make a description from the occupation terms, in lowercase with commas.
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
