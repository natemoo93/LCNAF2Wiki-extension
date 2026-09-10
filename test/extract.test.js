/**
 * The Node test runner:  node --test test/
 *
 * The core modules use only DOMParser and the standard DOM traversal methods.
 * Thus they operate outside of a browser with a DOMParser shim. This
 * portability is the reason to keep the chrome.* APIs out of core/.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';

globalThis.DOMParser = DOMParser;

const { parseMarcXml, datafields, subfields, subfield, MARCXML_NS } = await import('../core/marc.js');
const { extractFields, normalizeId, idFromUrl } = await import('../core/extract.js');

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
  // One datafield contains two occupations as a repeated $a.
  assert.deepEqual(subfields(f[0], 'a'), ['Sociologists', 'Sociology teachers']);
});

test('extractFields groups 100/400/374 with counts', () => {
  const out = extractFields(rec);
  assert.equal(out.heading, 'Sween, Joyce A.');
  const counts = Object.fromEntries(out.groups.map((g) => [g.tag, g.fields.length]));
  assert.deepEqual(counts, { 100: 1, 400: 3, 374: 1 });
});

test('each group carries a status driving its chip colour', () => {
  const byTag = Object.fromEntries(extractFields(rec).groups.map((g) => [g.tag, g]));
  // The record has a $q fuller form and two occupations. The cataloguer must
  // make a decision on each one. They are not defects in the record.
  assert.equal(byTag['100'].status, 'notable');
  assert.equal(byTag['374'].status, 'notable');
  // Three usual variant names. There is no condition to flag.
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
  // The terms can occur as a repeated $a or as separate fields. This is a
  // serialisation detail. The result is the same in the two conditions.
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

test('blue chips carry no message — the MARC line already shows the subfield', () => {
  const byTag = Object.fromEntries(extractFields(rec).groups.map((g) => [g.tag, g]));
  assert.deepEqual(byTag['100'].messages, []);
  assert.deepEqual(byTag['374'].messages, []);
  // The detail shows the field. The field contains the $q subfield and the
  // two occupation terms.
  assert.equal(byTag['100'].fields[0].display, '100 1# $a Sween, Joyce A. $q (Joyce Ann), $d 1937-');
  assert.equal(byTag['374'].fields[0].display, '374 ## $a Sociologists $a Sociology teachers $2 lcsh');
});

test('red chips do carry a message — the reason is not on the MARC line', () => {
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
  assert.match(g.messages[0], /check placement in direct order/i);
});

test('non-MARCXML response throws rather than silently yielding nothing', () => {
  // For some incorrect identifiers, LC sends an HTML error page and not a
  // 404 status. Thus a correctly formed document is not sufficient proof of a
  // record.
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
