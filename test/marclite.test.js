/**
 * Tests for the DOM-free MARCXML reader. These install no DOMParser shim,
 * because a shim would hide the failure a service worker finds.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { parseMarcLite } = await import('../core/marcLite.js');
const { datafields, subfields, subfield, allSubfields, indicators, controlfield } = await import(
  '../core/marc.js'
);

const NS = 'xmlns:marcxml="http://www.loc.gov/MARC21/slim"';

/** Put the given datafields in a record. */
function record(inner) {
  return parseMarcLite(`<?xml version="1.0"?>\n<marcxml:record ${NS}>${inner}</marcxml:record>`, 'n1');
}

test('there is no DOMParser in this test, as in a service worker', () => {
  assert.equal(typeof globalThis.DOMParser, 'undefined');
});

test('reads a datafield, its indicators and its subfields', () => {
  const rec = record(`
    <marcxml:datafield tag="100" ind1="1" ind2=" ">
      <marcxml:subfield code="a">Sween, Joyce A.</marcxml:subfield>
      <marcxml:subfield code="d">1937-</marcxml:subfield>
    </marcxml:datafield>`);

  const f = datafields(rec, '100')[0];
  assert.equal(subfield(f, 'a'), 'Sween, Joyce A.');
  assert.equal(subfield(f, 'd'), '1937-');
  assert.deepEqual(indicators(f), { ind1: '1', ind2: '#' });
});

test('a repeated subfield gives each value in order', () => {
  // The 374 field usually has more than one $a occupation.
  const rec = record(`
    <marcxml:datafield tag="374" ind1=" " ind2=" ">
      <marcxml:subfield code="a">Sociologists</marcxml:subfield>
      <marcxml:subfield code="a">Sociology teachers</marcxml:subfield>
    </marcxml:datafield>`);

  const f = datafields(rec, '374')[0];
  assert.deepEqual(subfields(f, 'a'), ['Sociologists', 'Sociology teachers']);
});

test('a repeated field gives each field in order', () => {
  const rec = record(`
    <marcxml:datafield tag="400" ind1="1" ind2=" ">
      <marcxml:subfield code="a">Sween, Joyce</marcxml:subfield>
    </marcxml:datafield>
    <marcxml:datafield tag="400" ind1="1" ind2=" ">
      <marcxml:subfield code="a">Sween, J.</marcxml:subfield>
    </marcxml:datafield>`);

  assert.equal(datafields(rec, '400').length, 2);
});

test('decodes the XML entities', () => {
  const rec = record(`
    <marcxml:datafield tag="100" ind1="1" ind2=" ">
      <marcxml:subfield code="a">Smith &amp; Sons &lt;Ltd&gt;</marcxml:subfield>
    </marcxml:datafield>`);

  assert.equal(subfield(datafields(rec, '100')[0], 'a'), 'Smith & Sons <Ltd>');
});

test('decodes a numeric character reference', () => {
  // LCNAF uses the modifier prime in transliterated names.
  const rec = record(`
    <marcxml:datafield tag="100" ind1="1" ind2=" ">
      <marcxml:subfield code="a">Arnol&#x2b9;d</marcxml:subfield>
    </marcxml:datafield>`);

  assert.equal(subfield(datafields(rec, '100')[0], 'a'), 'Arnolʹd');
});

test('reads a record that has no namespace prefix', () => {
  const rec = parseMarcLite(
    '<record xmlns="http://www.loc.gov/MARC21/slim">' +
      '<datafield tag="100" ind1="1" ind2=" ">' +
      '<subfield code="a">Plain, Name</subfield>' +
      '</datafield></record>',
    'n1',
  );
  assert.equal(subfield(datafields(rec, '100')[0], 'a'), 'Plain, Name');
});

test('reads a control field', () => {
  const rec = parseMarcLite(
    `<marcxml:record ${NS}><marcxml:controlfield tag="001">n50044114</marcxml:controlfield></marcxml:record>`,
    'n1',
  );
  assert.equal(controlfield(rec, '001'), 'n50044114');
});

test('ignores a comment that contains a tag', () => {
  const rec = record(`
    <!-- <marcxml:datafield tag="100"><marcxml:subfield code="a">Ghost</marcxml:subfield></marcxml:datafield> -->
    <marcxml:datafield tag="100" ind1="1" ind2=" ">
      <marcxml:subfield code="a">Real, Name</marcxml:subfield>
    </marcxml:datafield>`);

  const fields = datafields(rec, '100');
  assert.equal(fields.length, 1);
  assert.equal(subfield(fields[0], 'a'), 'Real, Name');
});

test('allSubfields gives each subfield in document order', () => {
  const rec = record(`
    <marcxml:datafield tag="100" ind1="1" ind2=" ">
      <marcxml:subfield code="a">Name</marcxml:subfield>
      <marcxml:subfield code="q">(Fuller Form)</marcxml:subfield>
      <marcxml:subfield code="d">1900-1980</marcxml:subfield>
    </marcxml:datafield>`);

  assert.deepEqual(
    allSubfields(datafields(rec, '100')[0]).map((s) => s.code),
    ['a', 'q', 'd'],
  );
});

test('text that is not a MARCXML record throws an error', () => {
  // LC sends an HTML error page for some identifiers.
  assert.throws(() => parseMarcLite('<html><body>Not found</body></html>', 'n1'), /not a MARCXML record/);
});

test('a missing tag attribute does not stop the reader', () => {
  const rec = record('<marcxml:datafield ind1="1" ind2=" "></marcxml:datafield>');
  assert.deepEqual(datafields(rec, '100'), []);
});
