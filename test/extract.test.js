/**
 * Run with: node --test test/
 * The core modules run outside a browser with a DOMParser shim.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';

globalThis.DOMParser = DOMParser;

const { parseMarcXml, datafields, subfields, subfield, MARCXML_NS } = await import('../core/marc.js');
const { extractFields, normalizeId, idFromUrl, headingFromUrl } = await import('../core/extract.js');

const xml = readFileSync(new URL('./fixtures/sample-374-multi400.xml', import.meta.url), 'utf8');
const rec = parseMarcXml(xml, 'no2012063640');

test('finds the 100 field regardless of attribute order', () => {
  const f = datafields(rec, '100');
  assert.equal(f.length, 1);
  assert.equal(subfield(f[0], 'a'), 'Sween, Joyce A.');
  assert.equal(subfield(f[0], 'd'), '1937-');
});

test('reads the $q fuller form subfield', () => {
  const f = datafields(rec, '100')[0];
  assert.equal(subfield(f, 'q'), '(Joyce Ann),');
});

test('returns every 400 field, not just the first', () => {
  const names = datafields(rec, '400').map((f) => subfield(f, 'a'));
  assert.deepEqual(names, ['Sween, J.,', 'Sween, Joyce,', 'Sween, Joyce Ann,']);
});

test('returns repeated $a subfields within one 374', () => {
  const f = datafields(rec, '374');
  assert.equal(f.length, 1, 'one 374 datafield');
  // One datafield has two occupations in a repeated $a.
  assert.deepEqual(subfields(f[0], 'a'), ['Sociologists', 'Sociology teachers']);
});

test('extractFields groups the read tags with counts', () => {
  const out = extractFields(rec);
  assert.equal(out.heading, 'Sween, Joyce A.');
  const counts = Object.fromEntries(out.groups.map((g) => [g.tag, g.fields.length]));
  // This record has no 500, so that group is empty.
  assert.deepEqual(counts, { 100: 1, 400: 3, 374: 1, 370: 1, 500: 0, '024': 0, '053': 0 });
});

test('each group carries a status driving its chip colour', () => {
  const byTag = Object.fromEntries(extractFields(rec).groups.map((g) => [g.tag, g]));
  // A $q fuller form and two occupations need a decision. They are not defects.
  assert.equal(byTag['100'].status, 'notable');
  assert.equal(byTag['374'].status, 'notable');
  // Three usual variant names. There is nothing to flag.
  assert.equal(byTag['400'].status, 'present');
});

test('occupations in separate 374 fields are collected together', () => {
  const multi = parseMarcXml(
    `<marcxml:record xmlns:marcxml="${MARCXML_NS}">
       <marcxml:datafield tag="100" ind1="1" ind2=" ">
         <marcxml:subfield code="a">Fischer, Irving</marcxml:subfield>
       </marcxml:datafield>
       <marcxml:datafield tag="374" ind1=" " ind2=" ">
         <marcxml:subfield code="a">Gynecologists</marcxml:subfield>
       </marcxml:datafield>
       <marcxml:datafield tag="374" ind1=" " ind2=" ">
         <marcxml:subfield code="a">Obstetricians</marcxml:subfield>
       </marcxml:datafield>
     </marcxml:record>`,
    'no2021084367',
  );
  // Repeated $a and separate fields give the same result.
  const g = extractFields(multi).groups.find((x) => x.tag === '374');
  assert.equal(g.status, 'notable');
  assert.deepEqual(g.fields.flatMap((f) => f.values), ['Gynecologists', 'Obstetricians']);
});

test('a field that is merely missing is absent, not an error', () => {
  const bare = parseMarcXml(
    `<marcxml:record xmlns:marcxml="${MARCXML_NS}">
       <marcxml:datafield tag="100" ind1="1" ind2=" ">
         <marcxml:subfield code="a">Masotti, Louis H.</marcxml:subfield>
       </marcxml:datafield>
     </marcxml:record>`,
    'n50044114',
  );
  const byTag = Object.fromEntries(extractFields(bare).groups.map((g) => [g.tag, g]));
  assert.equal(byTag['100'].status, 'present');
  assert.equal(byTag['374'].status, 'absent');
  assert.equal(byTag['400'].status, 'absent');
  assert.deepEqual(byTag['374'].messages, ['No occupation.']);
});

test('a corporate-name record flags 100 as attention', () => {
  const corp = parseMarcXml(
    `<marcxml:record xmlns:marcxml="${MARCXML_NS}">
       <marcxml:datafield tag="110" ind1="2" ind2=" ">
         <marcxml:subfield code="a">Northwestern University</marcxml:subfield>
       </marcxml:datafield>
     </marcxml:record>`,
    'n79058883',
  );
  const g = extractFields(corp).groups.find((x) => x.tag === '100');
  assert.equal(g.status, 'attention');
  assert.match(g.messages[0], /Corporate name/);
});

test('renders a MARC display line', () => {
  const out = extractFields(rec);
  const f = out.groups.find((g) => g.tag === '100').fields[0];
  assert.equal(f.display, '100 1# $a Sween, Joyce A. $q (Joyce Ann), $d 1937-');
});

test('yellow chips carry no message, because the MARC line shows the subfield', () => {
  const byTag = Object.fromEntries(extractFields(rec).groups.map((g) => [g.tag, g]));
  assert.deepEqual(byTag['100'].messages, []);
  assert.deepEqual(byTag['374'].messages, []);
  // The detail shows the field with $q and the terms.
  assert.equal(byTag['100'].fields[0].display, '100 1# $a Sween, Joyce A. $q (Joyce Ann), $d 1937-');
  assert.equal(byTag['374'].fields[0].display, '374 ## $a Sociologists $a Sociology teachers $2 lcsh');
});

test('red chips do carry a message, because the reason is not on the MARC line', () => {
  const titled = parseMarcXml(
    `<marcxml:record xmlns:marcxml="${MARCXML_NS}">
       <marcxml:datafield tag="100" ind1="1" ind2=" ">
         <marcxml:subfield code="a">Rothschild, Irwin B.,</marcxml:subfield>
         <marcxml:subfield code="c">III,</marcxml:subfield>
       </marcxml:datafield>
     </marcxml:record>`,
    'no2023108983',
  );
  const g = extractFields(titled).groups.find((x) => x.tag === '100');
  assert.equal(g.status, 'attention');
  assert.match(g.messages[0], /check the position in direct order/i);
});

test('a $c that is only a qualifier in parentheses does not change the chip colour', () => {
  const qualified = parseMarcXml(
    `<marcxml:record xmlns:marcxml="${MARCXML_NS}">
       <marcxml:datafield tag="100" ind1="0" ind2=" ">
         <marcxml:subfield code="a">Pat the Bunny</marcxml:subfield>
         <marcxml:subfield code="c">(Musician),</marcxml:subfield>
       </marcxml:datafield>
       <marcxml:datafield tag="400" ind1="1" ind2=" ">
         <marcxml:subfield code="a">Schneeweis, Patrick</marcxml:subfield>
         <marcxml:subfield code="c">(Musician),</marcxml:subfield>
       </marcxml:datafield>
     </marcxml:record>`,
    'no2022049974',
  );
  const byTag = Object.fromEntries(extractFields(qualified).groups.map((g) => [g.tag, g]));
  assert.equal(byTag['100'].status, 'present');
  assert.deepEqual(byTag['100'].messages, []);
  assert.equal(byTag['400'].status, 'present');
});

test('non-MARCXML response throws rather than silently yielding nothing', () => {
  // LC sends an HTML error page for some identifiers.
  // A well-formed document is not proof of a record.
  assert.throws(
    () => parseMarcXml('<html><body>Not found</body></html>', 'nX'),
    /not a MARCXML record/,
  );
});

test('normalizeId strips internal spaces', () => {
  assert.equal(normalizeId('n  83053245'), 'n83053245');
  assert.equal(normalizeId('  no2012063640 '), 'no2012063640');
});

test('idFromUrl pulls the id from LC page and MARCXML urls', () => {
  assert.equal(idFromUrl('https://id.loc.gov/authorities/names/n50044114.html'), 'n50044114');
  assert.equal(idFromUrl('https://id.loc.gov/authorities/names/n50044114'), 'n50044114');
  assert.equal(idFromUrl('https://example.com/'), undefined);
});

/* ---------- authorities.loc.gov URLs ---------- */

test('headingFromUrl reads headingRef from an authorities.loc.gov record URL', () => {
  const url =
    'https://authorities.loc.gov/authority/7e01ee74-5be1-4393-97ff-0fc465e9323c' +
    '?searchFields=name&searchType=begins&searchTerm=Twain%2C+Mark&limit=100' +
    '&sortBy=relevance&headingRef=Twain%2C+Mark%2C+1835-1910';
  assert.equal(headingFromUrl(url), 'Twain, Mark, 1835-1910');
  assert.equal(idFromUrl(url), undefined);
});

test('headingFromUrl keeps diacritics and parentheses', () => {
  const url =
    'https://authorities.loc.gov/authority/x?headingRef=' +
    encodeURIComponent('Tolkien, J. R. R. (John Ronald Reuel), 1892-1973');
  assert.equal(headingFromUrl(url), 'Tolkien, J. R. R. (John Ronald Reuel), 1892-1973');
  assert.equal(
    headingFromUrl('https://authorities.loc.gov/authority/x?headingRef=Dvo%C5%99%C3%A1k%2C+Anton%C3%ADn'),
    'Dvořák, Antonín',
  );
});

test('headingFromUrl gives nothing without headingRef or on another site', () => {
  assert.equal(headingFromUrl('https://authorities.loc.gov/authority/7e01ee74-5be1'), undefined);
  assert.equal(headingFromUrl('https://authorities.loc.gov/authority/x?headingRef=+'), undefined);
  assert.equal(headingFromUrl('https://example.com/authority/x?headingRef=Twain%2C+Mark'), undefined);
  assert.equal(headingFromUrl('not a url'), undefined);
});
