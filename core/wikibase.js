/**
 * The Wikidata REST API write client.
 *
 * A write carries a bearer token when the user is signed in. Wikidata also
 * takes the edit without one, and credits it to a temporary account, so a
 * token is optional here rather than required. The Item namespace is exempt
 * from ConfirmEdit, so a signed-out write meets no CAPTCHA; what it does
 * meet is a limit of eight edits a minute.
 */

import { USER_AGENT } from './wikidata.js';
import { buildItemBody } from './statements.js';

/** The REST API, version 1. */
const BASE = 'https://www.wikidata.org/w/rest.php/wikibase/v1';

/** The address of a Wikidata item page. */
const ITEM_URL = 'https://www.wikidata.org/wiki/';

/** The maximum wait. A write is slower than a read. */
const TIMEOUT_MS = 20000;

/**
 * @typedef {{
 *   id: string,
 *   url: string,
 *   label: string
 * }} CreatedItem
 */

/**
 * Create an item from a draft.
 *
 * @param {import('./mapper.js').WikidataDraft} draft
 * @param {{accessToken?: string, signal?: AbortSignal, now?: Date}} opts
 *   accessToken is optional. Without one the edit is anonymous.
 * @returns {Promise<CreatedItem>}
 */
export async function createItem(draft, opts) {
  // An item with neither a label nor a description is refused by the API,
  // and would be useless anyway.
  if (!draft?.label && !draft?.description) {
    throw apiError('An item needs a label or a description.', 'empty-item');
  }

  const body = buildItemBody(draft, { now: opts.now });
  const data = await request('POST', '/entities/items', body, opts);

  if (!data?.id) throw apiError('Wikidata saved the item but returned no id.', 'no-id');

  return {
    id: data.id,
    url: ITEM_URL + data.id,
    label: data.labels?.[draft.lang] ?? draft.label ?? '',
  };
}

/**
 * Read an item. Unauthenticated, because a read needs no identity, but the
 * User-Agent is still sent as the policy asks.
 *
 * @param {string} itemId
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<object>}
 */
export async function getItem(itemId, opts = {}) {
  return request('GET', `/entities/items/${encodeURIComponent(itemId)}`, undefined, opts);
}

/**
 * Add one statement to an item that exists. This is what fills in a P244 on
 * an item that a name match found.
 *
 * @param {string} itemId
 * @param {object} statement
 * @param {{accessToken?: string, comment?: string, signal?: AbortSignal}} opts
 * @returns {Promise<object>}
 */
export async function addStatement(itemId, statement, opts) {
  const body = {
    statement,
    comment: opts.comment ?? 'Added with LCNAF2Wiki',
  };

  return request(
    'POST',
    `/entities/items/${encodeURIComponent(itemId)}/statements`,
    body,
    opts,
  );
}

/**
 * Add to an item that exists, with a JSON Patch.
 *
 * The patch carries only `add` operations, so this can grow an item and
 * never shrink it. Refer to core/diff.js for how the patch is built.
 *
 * @param {string} itemId
 * @param {object[]} patch
 * @param {{accessToken?: string, comment?: string, signal?: AbortSignal}} opts
 * @returns {Promise<object>}
 */
export async function patchItem(itemId, patch, opts = {}) {
  if (!Array.isArray(patch) || patch.length === 0) {
    throw apiError('Nothing to add.', 'empty-patch');
  }

  // Refuse anything that is not an addition, whatever the caller passed.
  // This is the last place to stop a write that would remove data.
  const destructive = patch.find((op) => op?.op !== 'add');
  if (destructive) {
    throw apiError(`Refused a "${destructive.op}" operation. This tool only adds.`, 'not-additive');
  }

  const body = {
    patch,
    comment: opts.comment ?? 'Added with LCNAF2Wiki',
  };

  return request('PATCH', `/entities/items/${encodeURIComponent(itemId)}`, body, opts);
}

/**
 * One request against the REST API.
 * The Authorization header is set only when a token is given.
 *
 * @param {string} method
 * @param {string} path
 * @param {object | undefined} body
 * @param {{accessToken?: string, signal?: AbortSignal}} opts
 * @returns {Promise<object>}
 */
async function request(method, path, body, opts = {}) {
  const headers = {
    Accept: 'application/json',
    // A browser cannot set User-Agent, so Wikimedia also reads this one.
    'Api-User-Agent': USER_AGENT,
  };
  if (body) {
    // The patch endpoints take JSON Patch; everything else takes plain JSON.
    headers['Content-Type'] =
      method === 'PATCH' ? 'application/json-patch+json' : 'application/json';
  }
  if (opts.accessToken) headers.Authorization = `Bearer ${opts.accessToken}`;

  const timer = new AbortController();
  const t = setTimeout(() => timer.abort(), TIMEOUT_MS);
  const signal = anySignal([opts.signal, timer.signal]);

  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      signal,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    if (cause?.name === 'AbortError') {
      const stopped = opts.signal?.aborted;
      throw apiError(
        stopped ? 'The edit was cancelled.' : 'Wikidata did not answer in time.',
        stopped ? 'cancelled' : 'timeout',
      );
    }
    throw apiError(`Could not reach Wikidata. ${cause.message}`, 'network');
  } finally {
    clearTimeout(t);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    data = undefined;
  }

  if (!res.ok) throw responseError(res, data);

  return data;
}

/**
 * Turn an API failure into an error a cataloguer can act on.
 *
 * @param {Response} res
 * @param {object | undefined} data
 */
function responseError(res, data) {
  // The REST API names its failures in errorKey, and gives a message in
  // whichever languages it has.
  const key = data?.errorKey ?? data?.code ?? '';
  const message = data?.messageTranslations?.en ?? data?.message ?? '';

  if (res.status === 401) {
    // The token was rejected. A retry signed out would succeed, so the
    // caller is told the sign-in lapsed rather than that the save failed.
    return apiError('The sign-in has expired.', 'signed-out');
  }
  if (res.status === 403) {
    // A block, or a missing right. The message says which.
    return apiError(
      message || 'Wikidata refused the edit. The account may be blocked or lack rights.',
      'forbidden',
    );
  }
  if (res.status === 409 || res.status === 412) {
    // The item changed since it was read, so the patch no longer applies.
    return apiError('The item changed on Wikidata. Look it up again.', 'conflict');
  }
  if (res.status === 429) {
    return apiError('Wikidata is rate-limiting the edit. Wait, then try again.', 'rate-limit');
  }
  if (res.status === 422 || res.status === 400) {
    // The data was refused: a duplicate label and description pair, for one.
    return apiError(message || 'Wikidata refused the data.', key || 'invalid');
  }

  return apiError(message || `Wikidata returned ${res.status}.`, key || 'failed');
}

/**
 * An error carrying a code, so a caller can act on the kind.
 * @param {string} message
 * @param {string} code
 */
function apiError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
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
