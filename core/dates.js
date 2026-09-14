/**
 * Birth and death dates from 046 $f/$g, or 100 $d when 046 is absent.
 */

import { datafields, subfield } from './marc.js';

/**
 * @typedef {'day' | 'month' | 'year'} Precision
 * @typedef {{raw: string, year: number, month?: number, day?: number,
 *            precision: Precision, circa: boolean}} EdtfDate
 */

/**
 * Parse one date value from 046 or 100 $d.
 * Accepts YYYY, YYYY-MM, YYYY-MM-DD, YYYYMMDD, and approximation markers.
 *
 * @param {string | undefined} raw
 * @returns {EdtfDate | undefined}
 */
export function parseDate(raw) {
  if (!raw) return undefined;

  const text = String(raw).trim();
  if (!text) return undefined;

  const circa = /(^|\s)(ca\.?|approximately|circa)\s|~/i.test(text);

  // Remove the approximation words and EDTF markers before matching digits.
  const cleaned = text
    .replace(/(^|\s)(ca\.?|approximately|circa)\s*/gi, ' ')
    .replace(/[~?]/g, '')
    .trim();

  // The YYYYMMDD form without delimiters.
  const packed = /^(\d{4})(\d{2})(\d{2})$/.exec(cleaned);
  if (packed) {
    return build(cleaned, +packed[1], +packed[2], +packed[3], 'day', circa);
  }

  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleaned);
  if (ymd) return build(cleaned, +ymd[1], +ymd[2], +ymd[3], 'day', circa);

  const ym = /^(\d{4})-(\d{2})$/.exec(cleaned);
  if (ym) return build(cleaned, +ym[1], +ym[2], undefined, 'month', circa);

  const y = /^(\d{4})$/.exec(cleaned);
  if (y) return build(cleaned, +y[1], undefined, undefined, 'year', circa);

  return undefined;
}

/**
 * @returns {EdtfDate}
 */
function build(raw, year, month, day, precision, circa) {
  const d = { raw, year, precision, circa };
  if (month !== undefined) d.month = month;
  if (day !== undefined) d.day = day;
  return d;
}

/**
 * Divide a 100 $d date string into a birth part and a death part.
 * The forms are "1901-1989", "1937-" and "-1925". The hyphen is a separator.
 *
 * @param {string | undefined} raw
 * @returns {{birth?: EdtfDate, death?: EdtfDate}}
 */
export function parseHeadingDates(raw) {
  if (!raw) return {};

  const text = String(raw).trim().replace(/[,.]+$/, '');
  const at = text.indexOf('-');

  // No hyphen. A single year is ambiguous in MARC. Use it as the birth date.
  if (at < 0) {
    const only = parseDate(text);
    return only ? { birth: only } : {};
  }

  return {
    birth: parseDate(text.slice(0, at)),
    death: parseDate(text.slice(at + 1)),
  };
}

/**
 * Extract the dates from a record. Use 046 before 100 $d.
 *
 * @param {{doc: XMLDocument}} rec
 * @returns {{birth?: EdtfDate, death?: EdtfDate, source: '046' | '100$d' | 'none'}}
 */
export function extractDates(rec) {
  const f046 = datafields(rec, '046')[0];
  if (f046) {
    const birth = parseDate(subfield(f046, 'f'));
    const death = parseDate(subfield(f046, 'g'));
    if (birth || death) return { birth, death, source: '046' };
  }

  const f100 = datafields(rec, '100')[0];
  if (f100) {
    const { birth, death } = parseHeadingDates(subfield(f100, 'd'));
    if (birth || death) return { birth, death, source: '100$d' };
  }

  return { source: 'none' };
}

/**
 * The most recent birth year shown without a death date. A person born in this
 * year or before is not alive, so the birth year is not private data.
 */
export const PRIVACY_BIRTH_YEAR = 1915;

/**
 * Make a date range, with no parentheses.
 * With no death date, the birth year shows only for a person born in
 * PRIVACY_BIRTH_YEAR or before. Refer to the README for the privacy rule.
 *
 * @param {EdtfDate | undefined} birth
 * @param {EdtfDate | undefined} death
 * @returns {string | undefined}
 */
export function formatDateRange(birth, death) {
  if (!death) {
    // Show the birth year only for a person who is not alive.
    if (birth && birth.year <= PRIVACY_BIRTH_YEAR) return `${birth.year}-`;
    return undefined;
  }
  return birth ? `${birth.year}-${death.year}` : `-${death.year}`;
}

/**
 * The date range in parentheses, as a description shows it.
 * @param {EdtfDate | undefined} birth
 * @param {EdtfDate | undefined} death
 * @returns {string | undefined}
 */
export function formatDateParens(birth, death) {
  const range = formatDateRange(birth, death);
  return range ? `(${range})` : undefined;
}
