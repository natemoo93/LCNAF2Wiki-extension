import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';

globalThis.DOMParser = DOMParser;

const { parseMarcXml, MARCXML_NS } = await import('../core/marc.js');
const { extractDates, formatDateRange, parseDate, parseHeadingDates } = await import(
  '../core/dates.js'
);

const record = (inner, id = 'nTest') =>
  parseMarcXml(`<marcxml:record xmlns:marcxml="${MARCXML_NS}">${inner}</marcxml:record>`, id);

test('parses EDTF year, month and day precision', () => {
  assert.deepEqual(parseDate('1868'), { raw: '1868', year: 1868, precision: 'year', circa: false });
  assert.equal(parseDate('1902-08').precision, 'month');
  assert.equal(parseDate('1902-08-10').precision, 'day');
  assert.equal(parseDate('1902-08-10').day, 10);
});

test('parses the undelimited YYYYMMDD form', () => {
  // Record n00120107 in the sample has "18871003" and not the EDTF form.
  const d = parseDate('18871003');
  assert.equal(d.year, 1887);
  assert.equal(d.month, 10);
  assert.equal(d.day, 3);
  assert.equal(d.precision, 'day');
});

test('marks approximate dates', () => {
  assert.equal(parseDate('approximately 1868').circa, true);
  assert.equal(parseDate('ca. 1868').circa, true);
  assert.equal(parseDate('1868~').circa, true);
  assert.equal(parseDate('1868').circa, false);
});

test('returns undefined for unparseable input', () => {
  assert.equal(parseDate(''), undefined);
  assert.equal(parseDate(undefined), undefined);
  assert.equal(parseDate('active 19th century'), undefined);
});

test('splits a 100 $d range', () => {
  const both = parseHeadingDates('1901-1989');
  assert.equal(both.birth.year, 1901);
  assert.equal(both.death.year, 1989);
});

test('handles a living person and a death-only date', () => {
  const living = parseHeadingDates('1937-');
  assert.equal(living.birth.year, 1937);
  assert.equal(living.death, undefined);

  const dead = parseHeadingDates('-1925');
  assert.equal(dead.birth, undefined);
  assert.equal(dead.death.year, 1925);
});

test('prefers 046 over 100 $d', () => {
  const rec = record(`
    <marcxml:datafield tag="046" ind1=" " ind2=" ">
      <marcxml:subfield code="f">1902-08-10</marcxml:subfield>
      <marcxml:subfield code="g">1980-03-19</marcxml:subfield>
    </marcxml:datafield>
    <marcxml:datafield tag="100" ind1="1" ind2=" ">
      <marcxml:subfield code="a">Stuntz, Jeanne,</marcxml:subfield>
      <marcxml:subfield code="d">1902-1980</marcxml:subfield>
    </marcxml:datafield>`);

  const d = extractDates(rec);
  assert.equal(d.source, '046');
  // Only the 046 field gives day precision.
  assert.equal(d.birth.precision, 'day');
  assert.equal(d.birth.day, 10);
});

test('falls back to 100 $d when 046 is absent', () => {
  const rec = record(`
    <marcxml:datafield tag="100" ind1="1" ind2=" ">
      <marcxml:subfield code="a">Jones, Agnes,</marcxml:subfield>
      <marcxml:subfield code="d">1901-1989</marcxml:subfield>
    </marcxml:datafield>`);

  const d = extractDates(rec);
  assert.equal(d.source, '100$d');
  assert.equal(d.birth.year, 1901);
  assert.equal(d.death.year, 1989);
});

test('reports no dates when neither field carries one', () => {
  const rec = record(`
    <marcxml:datafield tag="100" ind1="1" ind2=" ">
      <marcxml:subfield code="a">Easton, Hazel</marcxml:subfield>
    </marcxml:datafield>`);
  assert.equal(extractDates(rec).source, 'none');
});

test('a birth date alone produces no range', () => {
  // The project rule is: use a birth date only when a death date is
  // present.
  assert.equal(formatDateRange(parseDate('1937'), undefined), undefined);
});

test('formats full and death-only ranges', () => {
  assert.equal(formatDateRange(parseDate('1901'), parseDate('1989')), '1901-1989');
  assert.equal(formatDateRange(undefined, parseDate('1925')), '-1925');
});
