/**
 * Name and date match against Wikidata, for records that no P244 search finds.
 * A match here is evidence, not proof, so the caller must let a person judge
 * it. Refer to the README.
 */

import { USER_AGENT } from './wikidata.js';

/** The query service reads live data, unlike the lagging search index. */
const SPARQL = 'https://query.wikidata.org/sparql';

/** The address of a Wikidata item page. */
const ITEM_URL = 'https://www.wikidata.org/wiki/';

/** The maximum wait. SPARQL is slower than the search index. */
const TIMEOUT_MS = 10000;

/**
 * How many years two dates can differ and still count as the same date.
 * Birth and death years disagree by one across catalogues often enough that
 * an exact test misses real duplicates.
 */
export const YEAR_TOLERANCE = 1;

/**
 * @typedef {{
 *   status: 'none' | 'possible' | 'skipped' | 'error',
 *   items: {id: string, url: string, label: string, birth: number, death: number}[],
 *   detail?: string
 * }} NameMatchResult
 */

/**
 * Look for an item with this name and both these years, and with no P244.
 * An item that has P244 is left out, because the P244 search already covers
 * it, and a different P244 means a different person.
 *
 * The function never throws. A failure gives the status 'error'.
 *
 * @param {{label: string, birth?: {year: number}, death?: {year: number}}} draft
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<NameMatchResult>}
 */
export async function findNameMatches(draft, opts = {}) {
  const label = String(draft?.label ?? '').trim();
  const birth = draft?.birth?.year;
  const death = draft?.death?.year;

  // Both years are necessary. A name and one year is too weak to show anyone.
  if (!label || !Number.isInteger(birth) || !Number.isInteger(death)) {
    return { status: 'skipped', items: [], detail: 'Needs a name, a birth year and a death year.' };
  }

  const query = buildQuery(label, birth, death);
  const url = `${SPARQL}?format=json&query=${encodeURIComponent(query)}`;

  const timer = new AbortController();
  const t = setTimeout(() => timer.abort(), TIMEOUT_MS);
  const signal = anySignal([opts.signal, timer.signal]);

  try {
    const res = await fetch(url, {
      signal,
      headers: {
        Accept: 'application/sparql-results+json',
        'Api-User-Agent': USER_AGENT,
        'User-Agent': USER_AGENT,
      },
    });

    if (res.status === 429) {
      return { status: 'error', items: [], detail: 'Wikidata rate limit. Check by hand.' };
    }
    if (!res.ok) {
      return { status: 'error', items: [], detail: `The query service returned ${res.status}.` };
    }

    const data = await res.json();
    const rows = data?.results?.bindings ?? [];
    if (rows.length === 0) return { status: 'none', items: [] };

    return { status: 'possible', items: rows.map(toItem).filter(Boolean) };
  } catch (cause) {
    if (cause?.name === 'AbortError') {
      const stopped = opts.signal?.aborted;
      return {
        status: 'error',
        items: [],
        detail: stopped ? 'Check cancelled.' : 'The query service did not answer in time.',
      };
    }
    return { status: 'error', items: [], detail: `Could not reach the query service. ${cause.message}` };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Build the SPARQL query. The label must match exactly, and both years must
 * fall within the tolerance. An item that already has P244 is excluded.
 *
 * @param {string} label
 * @param {number} birth
 * @param {number} death
 * @returns {string}
 */
export function buildQuery(label, birth, death) {
  const name = sparqlString(label);
  return `SELECT ?item ?itemLabel ?birth ?death WHERE {
  ?item rdfs:label ${name}@en .
  ?item wdt:P31 wd:Q5 .
  ?item wdt:P569 ?birthDate .
  ?item wdt:P570 ?deathDate .
  FILTER NOT EXISTS { ?item wdt:P244 ?lc . }
  BIND(YEAR(?birthDate) AS ?birth)
  BIND(YEAR(?deathDate) AS ?death)
  FILTER(ABS(?birth - ${birth}) <= ${YEAR_TOLERANCE})
  FILTER(ABS(?death - ${death}) <= ${YEAR_TOLERANCE})
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 5`;
}

/**
 * A SPARQL string literal. Quotes, backslashes and newlines are escaped, so
 * a name cannot end the literal and add to the query.
 *
 * @param {string} value
 * @returns {string}
 */
function sparqlString(value) {
  const bs = String.fromCharCode(92);
  const body = String(value)
    .split(bs)
    .join(bs + bs)
    .split('"')
    .join(bs + '"')
    .split(String.fromCharCode(10))
    .join(bs + 'n')
    .split(String.fromCharCode(13))
    .join(bs + 'r')
    .split(String.fromCharCode(9))
    .join(bs + 't');
  return '"' + body + '"';
}

/**
 * One result row as an item. A row with no usable item URI gives undefined.
 * @param {object} row
 */
function toItem(row) {
  const uri = row?.item?.value ?? '';
  const id = uri.split('/').pop();
  if (!/^Q\d+$/.test(id ?? '')) return undefined;

  return {
    id,
    url: ITEM_URL + id,
    label: row?.itemLabel?.value ?? '',
    birth: Number(row?.birth?.value),
    death: Number(row?.death?.value),
  };
}

/**
 * Make one signal that aborts when any given signal aborts.
 * @param {(AbortSignal | undefined)[]} signals
 * @returns {AbortSignal}
 */
function anySignal(signals) {
  const list = signals.filter(Boolean);
  if (list.length === 1) return list[0];
  if (typeof AbortSignal !== 'undefined' && AbortSignal.any) return AbortSignal.any(list);

  const ctl = new AbortController();
  for (const s of list) {
    if (s.aborted) {
      ctl.abort();
      break;
    }
    s.addEventListener('abort', () => ctl.abort(), { once: true });
  }
  return ctl.signal;
}
