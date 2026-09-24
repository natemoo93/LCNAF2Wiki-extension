/**
 * Text filters: plain find-and-replace over the values read from a record.
 * Pure: text in, text out, no I/O.
 *
 * LC sends text that a browser cannot always show, such as a non-Latin script
 * that arrives damaged, or a character the cataloguer's workflow replaces by
 * hand every time. A filter does that replacement once, in the settings.
 *
 * A filter is a literal string, not a pattern. A cataloguer pasting a broken
 * character must not have it read as a regular expression.
 */

/** The most filters one installation can hold. The store has a size limit. */
export const MAX_FILTERS = 50;

/** The longest either side of a filter can be. */
export const MAX_FILTER_LENGTH = 200;

/**
 * @typedef {{replace: string, with: string}} TextFilter
 */

/**
 * Apply every filter to one value, in order.
 * A filter with an empty `replace` is skipped, because replacing nothing
 * would insert the replacement between every character.
 *
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
 * Keep only the filters that can be used, and cut them to size.
 * A damaged store must not stop the popup, so anything unreadable is
 * dropped rather than thrown.
 *
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

    // An empty left side matches everywhere, so it is not a filter.
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
 *
 * @param {TextFilter} filter
 * @returns {string}
 */
export function describeFilter(filter) {
  const to = filter.with === '' ? '(nothing)' : filter.with;
  return `${filter.replace} -> ${to}`;
}
