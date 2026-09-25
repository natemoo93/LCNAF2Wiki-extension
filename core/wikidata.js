/**
 * Find duplicate items on Wikidata by P244 (LCNAF ID) and P214 (VIAF ID).
 * An exact identifier match is proof of a duplicate.
 */

const API = 'https://www.wikidata.org/w/api.php';

/** The Wikidata property for the Library of Congress authority ID. */
const P_LC_AUTHORITY = 'P244';

/** The Wikidata property for the VIAF cluster ID. */
const P_VIAF = 'P214';

/** The address of a Wikidata item page. */
const ITEM_URL = 'https://www.wikidata.org/wiki/';

/** Identify the extension to Wikimedia, as the policy tells. */
export const USER_AGENT =
  'LCNAF2Wiki/0.1 (Northwestern University Library; https://github.com/natemoo93/LCNAF2Wiki-extension)';

/** The maximum wait. A slow API must not lock the button. */
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
 * Find Wikidata items that have this LCNAF identifier in P244.
 * This function does not throw. A failure gives the status 'error'.
 * @param {string} lcnafId
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<DuplicateResult>}
 */
export async function findDuplicates(lcnafId, opts = {}) {
  const id = String(lcnafId ?? '').trim();
  if (!id) return { status: 'error', items: [], detail: 'There is no LCNAF identifier.' };

  return searchByStatement(P_LC_AUTHORITY, id, 'lcnaf', opts);
}

/**
 * Find Wikidata items that have this VIAF cluster number in P214.
 * This function does not throw. A failure gives the status 'error'.
 * @param {string} viaf
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<DuplicateResult>}
 */
export async function findByViaf(viaf, opts = {}) {
  const id = String(viaf ?? '').trim();
  if (!id) return { status: 'error', items: [], detail: 'There is no VIAF identifier.' };

  // A VIAF cluster number has only digits. Do not search for other text.
  if (!/^\d+$/.test(id)) {
    return { status: 'error', items: [], detail: 'The VIAF identifier is not a number.' };
  }

  return searchByStatement(P_VIAF, id, 'viaf', opts);
}

/**
 * Find items with an exact statement value.
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
      // Wikimedia refuses a request with no User-Agent.
      // A browser cannot set that header, so also send Api-User-Agent.
      headers: {
        Accept: 'application/json',
        'Api-User-Agent': USER_AGENT,
        'User-Agent': USER_AGENT,
      },
    });

    if (res.status === 429) {
      // A rate limit is not proof that the item does not exist.
      return { status: 'error', items: [], detail: 'Wikidata rate limit. Do the check manually.' };
    }
    if (!res.ok) {
      return { status: 'error', items: [], detail: `Wikidata sent error ${res.status}.` };
    }

    const data = await res.json();

    // The API gives its errors in the body, with a 200 status.
    if (data.error) {
      return { status: 'error', items: [], detail: data.error.info ?? 'The Wikidata API sent an error.' };
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
        detail: stopped ? 'You cancelled the check.' : 'Wikidata did not answer in the time limit.',
      };
    }
    return { status: 'error', items: [], detail: `Cannot connect to Wikidata. ${cause.message}` };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Make one signal that aborts when one of the given signals aborts.
 * Some browser versions do not have AbortSignal.any.
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
