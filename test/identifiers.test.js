/**
 * Test the external identifiers with a real LC record that has VIAF and seven other schemes.
 * Read only known sources. Ignore unknown sources.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';

globalThis.DOMParser = DOMParser;

const { parseMarcXml } = await import('../core/marc.js');
const { extractIdentifiers, normalizeViaf, viafId, wikidataId } = await import(
  '../core/identifiers.js'
);

const withViaf = parseMarcXml(
  fs.readFileSync(new URL('./fixtures/sample-024-viaf.xml', import.meta.url), 'utf8'),
  'n80076765',
);

const noIds = parseMarcXml(
  fs.readFileSync(new URL('./fixtures/sample-374-multi400.xml', import.meta.url), 'utf8'),
  'n83053245',
);

/* ---------- reading the record ---------- */

test('the VIAF cluster number is read from 024 $a', () => {
  assert.equal(viafId(withViaf), '113230702');
});

test('the Wikidata item id is read from 024 $a', () => {
  assert.equal(wikidataId(withViaf), 'Q42');
});

test('a record with no 024 gives no identifiers', () => {
  assert.equal(viafId(noIds), undefined);
  assert.equal(wikidataId(noIds), undefined);
  assert.deepEqual(extractIdentifiers(noIds), []);
});

test('a source the tool does not know is left out', () => {
  const sources = extractIdentifiers(withViaf).map((i) => i.source);

  // The record also has bbcth, fast, musicb, worldcat, and allmovie.
  assert.deepEqual(sources.sort(), ['viaf', 'wikidata']);
});

test('each identifier carries the Wikidata property to search', () => {
  const viaf = extractIdentifiers(withViaf).find((i) => i.source === 'viaf');
  assert.equal(viaf.property, 'P214');
});

/* ---------- the VIAF number ---------- */

test('a bare VIAF number is kept as it is', () => {
  assert.equal(normalizeViaf('113230702'), '113230702');
});

test('a VIAF address gives its number', () => {
  assert.equal(normalizeViaf('http://www.viaf.org/viaf/113230702'), '113230702');
  assert.equal(normalizeViaf('https://viaf.org/viaf/113230702/'), '113230702');
});

test('a value with no number gives nothing', () => {
  assert.equal(normalizeViaf('not a number'), undefined);
  assert.equal(normalizeViaf(''), undefined);
  assert.equal(normalizeViaf(undefined), undefined);
});

/* ---------- the Wikidata id ---------- */

test('a value that is not a QID is refused', () => {
  // A value that is not a QID must not go to a search.
  const rec = parseMarcXml(
    `<record xmlns="http://www.loc.gov/MARC21/slim">
       <datafield tag="024" ind1="7" ind2=" ">
         <subfield code="a">not-a-qid</subfield>
         <subfield code="2">wikidata</subfield>
       </datafield>
     </record>`,
    'test',
  );

  assert.equal(wikidataId(rec), undefined);
});

/* ---------- the indicator ---------- */

test('an 024 with a different indicator is not read', () => {
  // Only ind1 7 means that $2 names the source.
  // Another indicator is a different scheme.
  const rec = parseMarcXml(
    `<record xmlns="http://www.loc.gov/MARC21/slim">
       <datafield tag="024" ind1="0" ind2=" ">
         <subfield code="a">113230702</subfield>
         <subfield code="2">viaf</subfield>
       </datafield>
     </record>`,
    'test',
  );

  assert.equal(viafId(rec), undefined);
});

test('the same identifier listed twice is read once', () => {
  const rec = parseMarcXml(
    `<record xmlns="http://www.loc.gov/MARC21/slim">
       <datafield tag="024" ind1="7" ind2=" ">
         <subfield code="a">113230702</subfield>
         <subfield code="2">viaf</subfield>
       </datafield>
       <datafield tag="024" ind1="7" ind2=" ">
         <subfield code="a">113230702</subfield>
         <subfield code="2">viaf</subfield>
       </datafield>
     </record>`,
    'test',
  );

  assert.equal(extractIdentifiers(rec).length, 1);
});

test('the source is read whatever its case', () => {
  const rec = parseMarcXml(
    `<record xmlns="http://www.loc.gov/MARC21/slim">
       <datafield tag="024" ind1="7" ind2=" ">
         <subfield code="a">113230702</subfield>
         <subfield code="2">VIAF</subfield>
       </datafield>
     </record>`,
    'test',
  );

  assert.equal(viafId(rec), '113230702');
});
