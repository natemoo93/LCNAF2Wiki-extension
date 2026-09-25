/**
 * Write to the Wikidata REST API. The bearer token is optional.
 * Without a token, Wikidata uses a temporary account and a limit of eight edits a minute.
 */

import { USER_AGENT } from './wikidata.js';
import { buildItemBody } from './statements.js';

/** The REST API, version 1. */
const BASE = 'https://www.wikidata.org/w/rest.php/wikibase/v1';

/** The address of a Wikidata item page. */
const ITEM_URL = 'https://www.wikidata.org/wiki/';

/** The maximum wait. A write takes more time than a read. */
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
 * @param {import('./mapper.js').WikidataDraft} draft
 * @param {{accessToken?: string, signal?: AbortSignal, now?: Date}} opts
 *   accessToken is optional. Without it, the edit is anonymous.
 * @returns {Promise<CreatedItem>}
 */
export async function createItem(draft, opts) {
  // The API refuses an item with no label and no description.
  if (!draft?.label && !draft?.description) {
    throw apiError('An item must have a label or a description.', 'empty-item');
  }

  const body = buildItemBody(draft, { now: opts.now });
  const data = await request('POST', '/entities/items', body, opts);

  if (!data?.id) throw apiError('Wikidata saved the item but did not send its ID.', 'no-id');

  return {
    id: data.id,
    url: ITEM_URL + data.id,
    label: data.labels?.[draft.lang] ?? draft.label ?? '',
  };
}

/**
 * Read an item. Do not send a token. Send the User-Agent, as the policy tells.
 * @param {string} itemId
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<object>}
 */
export async function getItem(itemId, opts = {}) {
  return request('GET', `/entities/items/${encodeURIComponent(itemId)}`, undefined, opts);
}

/**
 * Add one statement to an item that exists.
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
 * Add to an item that exists, with a JSON Patch of `add` operations only.
 * Refer to core/diff.js for the patch.
 * @param {string} itemId
 * @param {object[]} patch
 * @param {{accessToken?: string, comment?: string, signal?: AbortSignal}} opts
 * @returns {Promise<object>}
 */
export async function patchItem(itemId, patch, opts = {}) {
  if (!Array.isArray(patch) || patch.length === 0) {
    throw apiError('There is nothing to add.', 'empty-patch');
  }

  // Refuse all operations that are not additions.
  // This is the last check before a write that removes data.
  const destructive = patch.find((op) => op?.op !== 'add');
  if (destructive) {
    throw apiError(`The tool refused a "${destructive.op}" operation. This tool only adds data.`, 'not-additive');
  }

  const body = {
    patch,
    comment: opts.comment ?? 'Added with LCNAF2Wiki',
  };

  return request('PATCH', `/entities/items/${encodeURIComponent(itemId)}`, body, opts);
}

/**
 * Send one request to the REST API.
 * Set the Authorization header only if a token is given.
 * @param {string} method
 * @param {string} path
 * @param {object | undefined} body
 * @param {{accessToken?: string, signal?: AbortSignal}} opts
 * @returns {Promise<object>}
 */
async function request(method, path, body, opts = {}) {
  const headers = {
    Accept: 'application/json',
    // A browser cannot set User-Agent, so Wikimedia also reads this header.
    'Api-User-Agent': USER_AGENT,
  };
  if (body) {
    // The patch endpoints use JSON Patch. The other endpoints use JSON.
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
        stopped ? 'You cancelled the edit.' : 'Wikidata did not answer in the time limit.',
        stopped ? 'cancelled' : 'timeout',
      );
    }
    throw apiError(`Cannot connect to Wikidata. ${cause.message}`, 'network');
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
 * Change an API failure into an error for the user.
 * @param {Response} res
 * @param {object | undefined} data
 */
function responseError(res, data) {
  // The REST API gives the failure in errorKey, and a message in some languages.
  const key = data?.errorKey ?? data?.code ?? '';
  const message = data?.messageTranslations?.en ?? data?.message ?? '';

  if (res.status === 401) {
    // Wikidata refused the token. Tell the caller that the sign-in is expired.
    return apiError('Your sign-in is expired.', 'signed-out');
  }
  if (res.status === 403) {
    // The account is blocked or does not have a right. The message tells which.
    return apiError(
      message || 'Wikidata refused the edit. The account can be blocked or not have the necessary rights.',
      'forbidden',
    );
  }
  if (res.status === 409 || res.status === 412) {
    // The item changed after the read, so the patch is not correct now.
    return apiError('The item changed on Wikidata. Find it again.', 'conflict');
  }
  if (res.status === 429) {
    return apiError('Wikidata limits the rate of edits. Wait, then try again.', 'rate-limit');
  }
  if (res.status === 422 || res.status === 400) {
    // Wikidata refused the data. An example is a duplicate label and description.
    return apiError(message || 'Wikidata refused the data.', key || 'invalid');
  }

  return apiError(message || `Wikidata sent error ${res.status}.`, key || 'failed');
}

/**
 * Make an error with a code, so that the caller can identify the type.
 * @param {string} message
 * @param {string} code
 */
function apiError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
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
