/**
 * Library of Congress fetch client, one record at a time.
 * No queue, no concurrency control, no cache. Batch mode would need those.
 */

import { normalizeId } from './extract.js';

const BASE = 'https://id.loc.gov/authorities/names/';

/** Identifies the extension to LC, with a contact. */
export const USER_AGENT = 'LCNAF2Wiki-prototype/0.1 (Northwestern University Library)';

/**
 * Fetch one authority record as MARCXML.
 *
 * @param {string} rawId
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<{id: string, xml: string, url: string}>}
 * @throws {Error} with a `code` of 'not-found' | 'http' | 'network'
 */
export async function fetchRecord(rawId, opts = {}) {
  const id = normalizeId(rawId);
  if (!id) throw taggedError('Empty LCNAF identifier.', 'not-found');

  const url = `${BASE}${encodeURIComponent(id)}.marcxml.xml`;

  let res;
  try {
    res = await fetch(url, {
      signal: opts.signal,
      headers: { Accept: 'application/xml' },
      redirect: 'follow',
    });
  } catch (cause) {
    // Covers no network, DNS failure and CORS rejection. A clear message
    // beats "Failed to fetch" if host_permissions is ever wrong.
    throw taggedError(`Could not reach id.loc.gov. ${cause.message}`, 'network');
  }

  if (res.status === 404) {
    throw taggedError(`No LCNAF record found for "${id}".`, 'not-found');
  }
  if (!res.ok) {
    throw taggedError(`id.loc.gov returned ${res.status} ${res.statusText}.`, 'http');
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
