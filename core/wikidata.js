/**
 * Wikidata duplicate check. An exact P244 match is proof of a duplicate;
 * a name match is not. The user turns this on in the settings.
 */

const API = 'https://www.wikidata.org/w/api.php';

/** The Wikidata property for the Library of Congress authority ID. */
const P_LC_AUTHORITY = 'P244';

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

  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: `haswbstatement:${P_LC_AUTHORITY}=${id}`,
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
