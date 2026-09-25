/**
 * Find and replace text in the values from a record.
 * A filter is a literal string, not a regular expression.
 */

/** The maximum number of filters. The storage has a size limit. */
export const MAX_FILTERS = 50;

/** The maximum length of each side of a filter. */
export const MAX_FILTER_LENGTH = 200;

/**
 * @typedef {{replace: string, with: string}} TextFilter
 */

/**
 * Apply each filter to one value, in sequence.
 * Skip a filter with an empty `replace`, because it matches between all characters.
 * @param {string} value
 * @param {TextFilter[]} filters
 * @returns {string}
 */
export function applyFilters(value, filters) {
  if (typeof value !== 'string' || !value) return value;
  if (!Array.isArray(filters) || filters.length === 0) return value;

  let out = value;
  for (const filter of filters) {
    const from = filter?.replace;
    if (typeof from !== 'string' || from === '') continue;

    const to = typeof filter.with === 'string' ? filter.with : '';
    out = out.split(from).join(to);
  }

  return out;
}

/**
 * Keep only the usable filters, and cut them to the maximum length.
 * Remove data that is not usable. Do not throw an error.
 * @param {unknown} filters
 * @returns {TextFilter[]}
 */
export function cleanFilters(filters) {
  if (!Array.isArray(filters)) return [];

  const out = [];
  for (const filter of filters) {
    if (!filter || typeof filter !== 'object') continue;

    const from = typeof filter.replace === 'string' ? filter.replace : '';
    const to = typeof filter.with === 'string' ? filter.with : '';

    // An empty left side matches all positions, so it is not a filter.
    if (!from) continue;

    out.push({
      replace: from.slice(0, MAX_FILTER_LENGTH),
      with: to.slice(0, MAX_FILTER_LENGTH),
    });

    if (out.length >= MAX_FILTERS) break;
  }

  return out;
}

/**
 * Show a filter as one line, for a note or a log.
 * @param {TextFilter} filter
 * @returns {string}
 */
export function describeFilter(filter) {
  const to = filter.with === '' ? '(nothing)' : filter.with;
  return `${filter.replace} -> ${to}`;
}
