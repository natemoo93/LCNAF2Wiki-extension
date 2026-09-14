import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';

globalThis.DOMParser = DOMParser;

const { parseMarcXml, MARCXML_NS } = await import('../core/marc.js');
const { mapRecord, aliasesAsText, DEFAULT_LANG } = await import('../core/mapper.js');
const { toQuickStatements } = await import('../core/quickstatements.js');

const record = (inner, id = 'nTest') =>
  parseMarcXml(`<marcxml:record xmlns:marcxml="${MARCXML_NS}">${inner}</marcxml:record>`, id);

const fixture = parseMarcXml(
  readFileSync(new URL('./fixtures/sample-374-multi400.xml', import.meta.url), 'utf8'),
  'no2012063640',
);

test('maps a full record to label, aliases and description', () => {
  const d = mapRecord(fixture);
  assert.equal(d.label, 'Joyce A. Sween');
  assert.deepEqual(d.aliases, ['J. Sween', 'Joyce Sween', 'Joyce Ann Sween']);
  assert.equal(d.description, 'sociologist, sociology teacher');
  assert.equal(d.descriptionSource, 'occupation');
  assert.equal(d.lang, DEFAULT_LANG);
  assert.equal(d.lcnafId, 'no2012063640');
});

test('aliases are pipe-separated on output', () => {
  assert.equal(aliasesAsText(mapRecord(fixture)), 'J. Sween|Joyce Sween|Joyce Ann Sween');
});

test('drops an alias identical to the label', () => {
  // A 400 that differs from the 100 only in its dates gives the same name.
  const rec = record(`
    <marcxml:datafield tag="100" ind1="1" ind2=" ">
      <marcxml:subfield code="a">Kammerer, John,</marcxml:subfield>
      <marcxml:subfield code="d">-1925</marcxml:subfield>
    </marcxml:datafield>
    <marcxml:datafield tag="400" ind1="1" ind2=" ">
      <marcxml:subfield code="w">nnea</marcxml:subfield>
      <marcxml:subfield code="a">Kammerer, John,</marcxml:subfield>
      <marcxml:subfield code="d">d. 1925</marcxml:subfield>
    </marcxml:datafield>`);

  const d = mapRecord(rec);
  assert.equal(d.label, 'John Kammerer');
  assert.deepEqual(d.aliases, []);
});

test('never treats $w control values as name text', () => {
  const rec = record(`
    <marcxml:datafield tag="100" ind1="1" ind2=" ">
      <marcxml:subfield code="a">Hale, G. E.</marcxml:subfield>
    </marcxml:datafield>
    <marcxml:datafield tag="400" ind1="1" ind2=" ">
      <marcxml:subfield code="w">nne</marcxml:subfield>
      <marcxml:subfield code="a">Hale, George Ellery</marcxml:subfield>
    </marcxml:datafield>`);

  const d = mapRecord(rec);
  assert.deepEqual(d.aliases, ['George Ellery Hale']);
  assert.ok(!aliasesAsText(d).includes('nne'));
});

test('an occupation and a date go in the same description', () => {
  // Regression: dates were once used only when no 374 was present.
  // Mark Twain (n79021164) has both.
  const rec = record(`
    <marcxml:datafield tag="046" ind1=" " ind2=" ">
      <marcxml:subfield code="f">1835-11-30</marcxml:subfield>
      <marcxml:subfield code="g">1910-04-21</marcxml:subfield>
    </marcxml:datafield>
    <marcxml:datafield tag="100" ind1="1" ind2=" ">
      <marcxml:subfield code="a">Twain, Mark,</marcxml:subfield>
      <marcxml:subfield code="d">1835-1910</marcxml:subfield>
    </marcxml:datafield>
    <marcxml:datafield tag="374" ind1=" " ind2=" ">
      <marcxml:subfield code="a">Authors</marcxml:subfield>
      <marcxml:subfield code="a">Lecturers</marcxml:subfield>
      <marcxml:subfield code="a">Humorists</marcxml:subfield>
    </marcxml:datafield>`);

  const d = mapRecord(rec);
  assert.equal(d.description, 'author, lecturer, humorist (1835-1910)');
  assert.equal(d.descriptionSource, 'occupation+dates');
});

test('an occupation with no date gives no parentheses', () => {
  const rec = record(`
    <marcxml:datafield tag="100" ind1="1" ind2=" ">
      <marcxml:subfield code="a">Doe, Jane,</marcxml:subfield>
    </marcxml:datafield>
    <marcxml:datafield tag="374" ind1=" " ind2=" ">
      <marcxml:subfield code="a">Authors</marcxml:subfield>
    </marcxml:datafield>`);

  const d = mapRecord(rec);
  assert.equal(d.description, 'author');
  assert.equal(d.descriptionSource, 'occupation');
});

test('the privacy rule applies when there is also an occupation', () => {
  // A person who can be alive gets the occupation and no date.
  const rec = record(`
    <marcxml:datafield tag="100" ind1="1" ind2=" ">
      <marcxml:subfield code="a">Doe, Jane,</marcxml:subfield>
      <marcxml:subfield code="d">1937-</marcxml:subfield>
    </marcxml:datafield>
    <marcxml:datafield tag="374" ind1=" " ind2=" ">
      <marcxml:subfield code="a">Authors</marcxml:subfield>
    </marcxml:datafield>`);

  const d = mapRecord(rec);
  assert.equal(d.description, 'author');
  assert.equal(d.descriptionSource, 'occupation');
});

test('a person born early enough gets the open range with the occupation', () => {
  const rec = record(`
    <marcxml:datafield tag="100" ind1="1" ind2=" ">
      <marcxml:subfield code="a">Doe, Jane,</marcxml:subfield>
      <marcxml:subfield code="d">1906-</marcxml:subfield>
    </marcxml:datafield>
    <marcxml:datafield tag="374" ind1=" " ind2=" ">
      <marcxml:subfield code="a">Authors</marcxml:subfield>
    </marcxml:datafield>`);

  assert.equal(mapRecord(rec).description, 'author (1906-)');
});

test('falls back to a date range when there is no 374', () => {
  const rec = record(`
    <marcxml:datafield tag="100" ind1="1" ind2=" ">
      <marcxml:subfield code="a">Jones, Agnes Elizabeth,</marcxml:subfield>
      <marcxml:subfield code="d">1901-1989</marcxml:subfield>
    </marcxml:datafield>`);

  const d = mapRecord(rec);
  // The years are always in parentheses in a description.
  assert.equal(d.description, '(1901-1989)');
  assert.equal(d.descriptionSource, 'dates');
});

test('a person who can be alive and has no occupation gets no description', () => {
  // This person was born after PRIVACY_BIRTH_YEAR, so no date shows.
  const rec = record(`
    <marcxml:datafield tag="100" ind1="1" ind2=" ">
      <marcxml:subfield code="a">Sween, Joyce A.</marcxml:subfield>
      <marcxml:subfield code="d">1937-</marcxml:subfield>
    </marcxml:datafield>`);

  const d = mapRecord(rec);
  assert.equal(d.description, '');
  assert.equal(d.descriptionSource, 'none');
  assert.ok(d.warnings.some((w) => w.code === 'no-description'));
});

test('a death-only date still produces a description', () => {
  const rec = record(`
    <marcxml:datafield tag="100" ind1="1" ind2=" ">
      <marcxml:subfield code="a">Chandler, Daniel W.,</marcxml:subfield>
      <marcxml:subfield code="d">-1864</marcxml:subfield>
    </marcxml:datafield>`);
  assert.equal(mapRecord(rec).description, '(-1864)');
});

test('flags a $c title without placing it', () => {
  const rec = record(`
    <marcxml:datafield tag="100" ind1="1" ind2=" ">
      <marcxml:subfield code="a">Rothschild, Irwin B.,</marcxml:subfield>
      <marcxml:subfield code="c">III,</marcxml:subfield>
    </marcxml:datafield>`);

  const d = mapRecord(rec);
  assert.equal(d.label, 'Irwin B. Rothschild');
  assert.ok(d.warnings.some((w) => w.code === 'label-uncertain'));
});

test('reports a corporate record rather than inventing a label', () => {
  const rec = record(`
    <marcxml:datafield tag="110" ind1="2" ind2=" ">
      <marcxml:subfield code="a">Northwestern University</marcxml:subfield>
    </marcxml:datafield>`);

  const d = mapRecord(rec);
  assert.equal(d.label, '');
  const w = d.warnings.find((x) => x.code === 'no-personal-name');
  assert.match(w.detail, /corporate name/i);
});

test('QuickStatements emits terms and the P244 provenance statement', () => {
  const qs = toQuickStatements(mapRecord(fixture));
  const lines = qs.split('\n');

  assert.equal(lines[0], 'CREATE');
  assert.ok(lines.includes('LAST\tLen\t"Joyce A. Sween"'));
  assert.ok(lines.includes('LAST\tDen\t"sociologist, sociology teacher"'));
  assert.ok(lines.includes('LAST\tAen\t"Joyce Ann Sween"'));
  assert.ok(lines.includes('LAST\tP244\t"no2012063640"'));
});

test('QuickStatements escapes embedded quotes', () => {
  const rec = record(`
    <marcxml:datafield tag="100" ind1="0" ind2=" ">
      <marcxml:subfield code="a">The "Kid"</marcxml:subfield>
    </marcxml:datafield>`);
  assert.ok(toQuickStatements(mapRecord(rec)).includes('\\"Kid\\"'));
});

test('omits empty fields from QuickStatements', () => {
  const rec = record(`
    <marcxml:datafield tag="100" ind1="1" ind2=" ">
      <marcxml:subfield code="a">Easton, Hazel</marcxml:subfield>
    </marcxml:datafield>`);

  const qs = toQuickStatements(mapRecord(rec));
  assert.ok(qs.includes('LAST\tLen\t"Hazel Easton"'));
  assert.ok(!qs.includes('Den'));
  assert.ok(!qs.includes('Aen'));
});
