/**
 * Test the see-also tracings. The data comes from real LCNAF records.
 * The tool must not decide that two names are one person.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';

globalThis.DOMParser = DOMParser;

const { parseMarcXml, MARCXML_NS } = await import('../core/marc.js');
const { extractRelated, relatedAsText } = await import('../core/related.js');

/** Make a record from datafield XML. */
function record(inner) {
  return parseMarcXml(
    `<marcxml:record xmlns:marcxml="${MARCXML_NS}">
       <marcxml:datafield tag="100" ind1="1" ind2=" ">
         <marcxml:subfield code="a">Test, Person</marcxml:subfield>
       </marcxml:datafield>
       ${inner}
     </marcxml:record>`,
    'n1',
  );
}

/** Make one 500 field. */
function tracing(subs) {
  const body = subs
    .map(([code, value]) => `<marcxml:subfield code="${code}">${value}</marcxml:subfield>`)
    .join('');
  return `<marcxml:datafield tag="500" ind1="1" ind2=" ">${body}</marcxml:datafield>`;
}

/* ---------- reading the field ---------- */

test('a 500 with no designator is unclear', () => {
  // Elvis Costello: "Dynamite, Napoleon" with no $w and no $i.
  const [related] = extractRelated(record(tracing([['a', 'Dynamite, Napoleon']])));

  // The name is in direct order for Wikidata.
  assert.equal(related.name, 'Napoleon Dynamite');
  // The heading keeps the form from the record.
  assert.equal(related.heading, 'Dynamite, Napoleon');
  assert.equal(related.confidence, 'unclear');
  assert.equal(related.sameIdentity, undefined, 'the tool must not decide');
});

test('a heading already in direct order is left alone', () => {
  // ind1 0 means that the heading is not inverted. An example is a one-word persona.
  const rec = parseMarcXml(
    `<marcxml:record xmlns:marcxml="${MARCXML_NS}">
       <marcxml:datafield tag="500" ind1="0" ind2=" ">
         <marcxml:subfield code="a">Imposter</marcxml:subfield>
         <marcxml:subfield code="c">(Musician)</marcxml:subfield>
       </marcxml:datafield>
     </marcxml:record>`,
    'n1',
  );

  const [related] = extractRelated(rec);
  assert.equal(related.name, 'Imposter');
});

test('a stated real identity is read as the same person', () => {
  // Richard Bachman: $w r $i Real identity: $a King, Stephen
  const [related] = extractRelated(
    record(tracing([['w', 'r'], ['i', 'Real identity:'], ['a', 'King, Stephen,'], ['d', '1947-']])),
  );

  assert.equal(related.confidence, 'stated');
  assert.equal(related.sameIdentity, true);
  assert.equal(related.designator, 'Real identity');
});

test('a designator the tool does not know is reported, not assumed', () => {
  const [related] = extractRelated(
    record(tracing([['i', 'Collaborator:'], ['a', 'Williams, Graham']])),
  );

  assert.equal(related.confidence, 'stated');
  assert.equal(related.sameIdentity, false, 'an unknown designator is not an identity');
  assert.equal(related.designator, 'Collaborator');
});

test('the trailing comma of a heading is dropped', () => {
  const [related] = extractRelated(record(tracing([['a', 'Clemens, Samuel Langhorne,']])));

  assert.equal(related.heading, 'Clemens, Samuel Langhorne');
  assert.equal(related.name, 'Samuel Langhorne Clemens');
});

test('a 500 with no name is skipped', () => {
  assert.deepEqual(extractRelated(record(tracing([['w', 'nnnc']]))), []);
});

test('a record with no 500 gives nothing', () => {
  assert.deepEqual(extractRelated(record('')), []);
});

test('every 500 is read, not only the first', () => {
  const related = extractRelated(
    record(
      tracing([['a', 'Dynamite, Napoleon']]) + tracing([['a', 'Imposter'], ['c', '(Musician)']]),
    ),
  );

  assert.equal(related.length, 2);
});

/* ---------- the copy text ---------- */

test('the copy text is the names in direct order with vertical bars', () => {
  const related = extractRelated(
    record(tracing([['a', 'Dynamite, Napoleon']]) + tracing([['a', 'Imposter']])),
  );

  assert.equal(relatedAsText(related), 'Napoleon Dynamite|Imposter');
});

test('the copy text makes no claim about the relationship', () => {
  // A stated identity and an unstated identity give the same form.
  const stated = extractRelated(
    record(tracing([['i', 'Real identity:'], ['a', 'King, Stephen,']])),
  );
  const unclear = extractRelated(record(tracing([['a', 'Agnew, David']])));

  assert.equal(relatedAsText(stated), 'Stephen King');
  assert.equal(relatedAsText(unclear), 'David Agnew');
});

test('no tracings gives empty copy text', () => {
  assert.equal(relatedAsText([]), '');
});

/* ---------- the two records that look alike ---------- */

test('Twain and Adams read the same, so neither is acted on', () => {
  // Both records have 500 $w nnnc with a name, but the meanings are opposite.
  const twain = extractRelated(
    record(tracing([['w', 'nnnc'], ['a', 'Clemens, Samuel Langhorne,'], ['d', '1835-1910']])),
  );
  const adams = extractRelated(record(tracing([['w', 'nnnc'], ['a', 'Agnew, David']])));

  assert.equal(twain[0].confidence, 'unclear');
  assert.equal(adams[0].confidence, 'unclear');
  assert.equal(twain[0].sameIdentity, undefined);
  assert.equal(adams[0].sameIdentity, undefined);
});

/* ---------- a real record ---------- */

test('the Elvis Costello record surfaces its pseudonyms without using them', async () => {
  const { readFileSync } = await import('node:fs');
  const { extractFields } = await import('../core/extract.js');
  const { mapRecord } = await import('../core/mapper.js');

  const rec = parseMarcXml(
    readFileSync(new URL('./fixtures/sample-500-pseudonym.xml', import.meta.url), 'utf8'),
    'n86032613',
  );

  const group = extractFields(rec).groups.find((g) => g.tag === '500');

  // The chip shows both personas and is yellow.
  assert.equal(group.fields.length, 2);
  assert.equal(group.status, 'notable');
  assert.match(group.copyText, /Napoleon Dynamite/);

  // The aliases have only the 400 variants.
  const draft = mapRecord(rec);
  assert.ok(!draft.aliases.some((a) => /Dynamite|Imposter/i.test(a)));
  assert.deepEqual(draft.aliases, [
    'D. P. A. MacManus',
    'Declan Patrick Aloysius MacManus',
  ]);
});
