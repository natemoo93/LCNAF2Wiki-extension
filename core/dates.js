/**
 * Birth and death dates.
 *
 * There are two sources. Use them in this order of preference:
 *
 *   046 $f / $g  Structured data. Usually EDTF. Frequently day precision.
 *                60 of the 92 sample records have this field.
 *   100 $d       The date string in the heading. Year precision at best.
 *                64 records have this field. 54 records have both fields.
 *                22 records have neither field.
 *
 * Use 046 when it is present. It is the more precise field.
 *
 * The 046 field is not always correctly formed. One sample record has
 * "18871003" and not the EDTF "1887-10-03". Thus the parser accepts the two
 * formats.
 */

import { datafields, subfield } from './marc.js';

/**
 * @typedef {'day' | 'month' | 'year'} Precision
 * @typedef {{raw: string, year: number, month?: number, day?: number,
 *            precision: Precision, circa: boolean}} EdtfDate
 */

/**
 * Parse one date value from 046 or 100$d.
 *
 * The parser accepts `YYYY`, `YYYY-MM`, `YYYY-MM-DD`, the `YYYYMMDD` form
 * without delimiters, and approximation markers ("approximately 1868",
 * "ca. 1868", EDTF "1868~").
 *
 * @param {string | undefined} raw
 * @returns {EdtfDate | undefined}
 */
export function parseDate(raw) {
  if (!raw) return undefined;

  const text = String(raw).trim();
  if (!text) return undefined;

  const circa = /(^|\s)(ca\.?|approximately|circa)\s|~/i.test(text);

  // Remove the approximation words and the EDTF markers before you match
  // the digits.
  const cleaned = text
    .replace(/(^|\s)(ca\.?|approximately|circa)\s*/gi, ' ')
    .replace(/[~?]/g, '')
    .trim();

  // The YYYYMMDD form without delimiters. Example: "18871003".
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
 *
 * The sample data contains these forms: "1901-1989", "1937-" (the person is
 * alive), and "-1925" (death date only). The hyphen is the separator. It is
 * not a minus sign.
 *
 * @param {string | undefined} raw
 * @returns {{birth?: EdtfDate, death?: EdtfDate}}
 */
export function parseHeadingDates(raw) {
  if (!raw) return {};

  const text = String(raw).trim().replace(/[,.]+$/, '');
  const at = text.indexOf('-');

  // There is no hyphen. A single year is ambiguous in MARC. Use it as the
  // birth date. This has an effect only when there is no death date. In that
  // condition the tool does not make a description.
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
 * Make a date range for use as a description.
 *
 * The project rule is: show a birth date only when a death date is present.
 * Thus a person who is alive gets no description. Do not show only a birth
 * year.
 *
 * @param {EdtfDate | undefined} birth
 * @param {EdtfDate | undefined} death
 * @returns {string | undefined}
 */
export function formatDateRange(birth, death) {
  if (!death) return undefined;
  return birth ? `${birth.year}-${death.year}` : `-${death.year}`;
}
