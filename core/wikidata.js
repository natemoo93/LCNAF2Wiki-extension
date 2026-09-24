/**
 * Wikidata duplicate check. An exact match on an authority identifier is
 * proof of a duplicate; a name match is not. The user turns this on in the
 * settings.
 *
 * Two identifiers are searched. P244 carries the LCNAF id, and P214 carries
 * the VIAF cluster number that LC records in the 024 field. VIAF clusters LC
 * with the national libraries, so an item built from a German or French
 * record holds the same VIAF number and no P244 at all. That item is a real
 * duplicate that a P244 search alone cannot find.
 */

const API = 'https://www.wikidata.org/w/api.php';

/** The Wikidata property for the Library of Congress authority ID. */
const P_LC_AUTHORITY = 'P244';

/** The Wikidata property for the VIAF cluster ID. */
const P_VIAF = 'P214';

/** The address of a Wikidata item page. */
const ITEM_URL = 'https://www.wikidata.org/wiki/';

/** Identifies the extension to Wikimedia, as their policy asks. */
export const USER_AGENT =
  'LCNAF2Wiki/0.1 (Northwestern University Library; https://github.com/natemoo93/LCNAF2Wiki-extension)';

/** The maximum wait. A slow API must not keep the button locked. */
const TIMEOUT_MS = 6000;

/**
 * @typedef {{
 *   status: 'none' | 'duplicate' | 'error',
 *   items: {id: string, url: string}[],
 *   matchedBy?: 'lcnaf' | 'viaf',
 *   detail?: string
 * }} DuplicateResult
 */

/**
 * Look for Wikidata items that have this LCNAF identifier in P244.
 * The function never throws. A failure gives the status 'error'.
 *
 * @param {string} lcnafId
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<DuplicateResult>}
 */
export async function findDuplicates(lcnafId, opts = {}) {
  const id = String(lcnafId ?? '').trim();
  if (!id) return { status: 'error', items: [], detail: 'No LCNAF identifier.' };

  return searchByStatement(P_LC_AUTHORITY, id, 'lcnaf', opts);
}

/**
 * Look for Wikidata items that carry this VIAF cluster number in P214.
 * The VIAF number comes from the 024 field of the LC record, so this only
 * runs for a record that names one.
 *
 * The function never throws. A failure gives the status 'error'.
 *
 * @param {string} viaf
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<DuplicateResult>}
 */
export async function findByViaf(viaf, opts = {}) {
  const id = String(viaf ?? '').trim();
  if (!id) return { status: 'error', items: [], detail: 'No VIAF identifier.' };

  // A VIAF cluster number is digits. Anything else would search for text.
  if (!/^\d+$/.test(id)) {
    return { status: 'error', items: [], detail: 'VIAF identifier is not a number.' };
  }

  return searchByStatement(P_VIAF, id, 'viaf', opts);
}

/**
 * Search for items carrying an exact statement value.
 * One request shape serves every identifier property.
 *
 * @param {string} property
 * @param {string} value
 * @param {'lcnaf' | 'viaf'} matchedBy
 * @param {{signal?: AbortSignal}} opts
 * @returns {Promise<DuplicateResult>}
 */
async function searchByStatement(property, value, matchedBy, opts) {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: `haswbstatement:${property}=${value}`,
    srlimit: '5',
    format: 'json',
    origin: '*',
  });

  // Stop the request after TIMEOUT_MS. The caller can also stop the request
  // with its own signal.
  const timer = new AbortController();
  const t = setTimeout(() => timer.abort(), TIMEOUT_MS);
  const signal = anySignal([opts.signal, timer.signal]);

  try {
    const res = await fetch(`${API}?${params}`, {
      signal,
      // Wikimedia refuses a request with no descriptive User-Agent. A browser
      // cannot set that header, so the API also accepts Api-User-Agent.
      headers: {
        Accept: 'application/json',
        'Api-User-Agent': USER_AGENT,
        'User-Agent': USER_AGENT,
      },
    });

    if (res.status === 429) {
      // A rate limit is not proof that the item is absent.
      return { status: 'error', items: [], detail: 'Wikidata rate limit. Check by hand.' };
    }
    if (!res.ok) {
      return { status: 'error', items: [], detail: `Wikidata returned ${res.status}.` };
    }

    const data = await res.json();

    // The API reports its own errors in the body, with a 200 status.
    if (data.error) {
      return { status: 'error', items: [], detail: data.error.info ?? 'Wikidata API error.' };
    }

    const hits = data?.query?.search ?? [];
    if (hits.length === 0) return { status: 'none', items: [] };

    return {
      status: 'duplicate',
      matchedBy,
      items: hits.map((h) => ({ id: h.title, url: ITEM_URL + h.title })),
    };
  } catch (cause) {
    if (cause?.name === 'AbortError') {
      // The caller stopped the request, or it reached the time limit.
      const stopped = opts.signal?.aborted;
      return {
        status: 'error',
        items: [],
        detail: stopped ? 'Check cancelled.' : 'Wikidata did not answer in time.',
      };
    }
    return { status: 'error', items: [], detail: `Could not reach Wikidata. ${cause.message}` };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Make one signal that aborts when any given signal aborts.
 * AbortSignal.any is not in every browser version, so this does the same.
 *
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
