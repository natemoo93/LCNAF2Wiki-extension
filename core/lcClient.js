/**
 * Library of Congress fetch client.
 *
 * The prototype gets one record at a time. It has no queue, no concurrency
 * control, and no cache. Batch mode needs those functions. This module does
 * not have them.
 */

import { normalizeId } from './extract.js';

const BASE = 'https://id.loc.gov/authorities/names/';

/** Identifies the extension to LC and gives a contact for unusual conditions. */
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
    // This condition includes no network, a DNS failure, and a CORS
    // rejection. The host_permissions setting prevents a CORS rejection. But
    // if the manifest is incorrect, a clear message is better than "Failed to
    // fetch".
    throw taggedError(`Could not reach id.loc.gov — ${cause.message}`, 'network');
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
