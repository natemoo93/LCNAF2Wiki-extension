/**
 * Get records from the Library of Congress, one record at a time.
 * This client has no queue, no concurrency control, and no cache.
 */

import { normalizeId } from './extract.js';

const BASE = 'https://id.loc.gov/authorities/names/';

/** Identify the extension to LC, with a contact. */
export const USER_AGENT = 'LCNAF2Wiki-prototype/0.1 (Northwestern University Library)';

/**
 * Get one authority record as MARCXML.
 * @param {string} rawId
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<{id: string, xml: string, url: string}>}
 * @throws {Error} with a `code` of 'not-found' | 'http' | 'network'
 */
export async function fetchRecord(rawId, opts = {}) {
  const id = normalizeId(rawId);
  if (!id) throw taggedError('The LCNAF identifier is empty.', 'not-found');

  const url = `${BASE}${encodeURIComponent(id)}.marcxml.xml`;

  let res;
  try {
    res = await fetch(url, {
      signal: opts.signal,
      headers: { Accept: 'application/xml' },
      redirect: 'follow',
    });
  } catch (cause) {
    // This includes no network, DNS failure, and CORS refusal.
    throw taggedError(`Cannot connect to id.loc.gov. ${cause.message}`, 'network');
  }

  if (res.status === 404) {
    throw taggedError(`There is no LCNAF record for "${id}".`, 'not-found');
  }
  if (!res.ok) {
    throw taggedError(`id.loc.gov sent error ${res.status} ${res.statusText}.`, 'http');
  }

  return { id, xml: await res.text(), url };
}

/**
 * @param {string} message
 * @param {'not-found' | 'http' | 'network'} code
 */
function taggedError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}
