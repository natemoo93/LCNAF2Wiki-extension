/**
 * Test the statements. These functions do not use the network.
 * The tool must write only what the record states.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { buildItemBody, buildStatements, timeValue } = await import(
  '../core/statements.js'
);

/** A draft with all fields filled in. */
function draft(over = {}) {
  return {
    lcnafId: 'n50044114',
    lang: 'en',
    label: 'Mark Twain',
    description: 'author (1835-1910)',
    aliases: ['Samuel Langhorne Clemens'],
    birth: { year: 1835 },
    death: { year: 1910 },
    warnings: [],
    ...over,
  };
}

/* ---------- the statements ---------- */

test('every record gets instance of human', () => {
  const s = buildStatements(draft());
  assert.equal(s.P31[0].value.content, 'Q5');
});

test('the LCNAF id is written as P244', () => {
  const s = buildStatements(draft());
  assert.equal(s.P244[0].value.content, 'n50044114');
});

test('the P244 statement carries a reference saying where it came from', () => {
  const s = buildStatements(draft(), { now: new Date('2026-09-23T12:00:00Z') });
  const parts = s.P244[0].references[0].parts;

  // Stated in the LC Name Authority File.
  assert.equal(parts[0].property.id, 'P248');
  assert.equal(parts[0].value.content, 'Q13219454');

  // Retrieved today.
  assert.equal(parts[1].property.id, 'P813');
  assert.equal(parts[1].value.content.time, '+2026-09-23T00:00:00Z');
});

test('a record with no identifier writes no P244', () => {
  const s = buildStatements(draft({ lcnafId: '' }));
  assert.equal(s.P244, undefined);
  assert.ok(s.P31, 'the record is still a person');
});

test('no date or occupation statement is written', () => {
  const s = buildStatements(draft());

  // Dates and occupations stay in the description. Refer to the README.
  assert.equal(s.P569, undefined, 'no date of birth');
  assert.equal(s.P570, undefined, 'no date of death');
  assert.equal(s.P106, undefined, 'no occupation');
});

/* ---------- the time value ---------- */

test('a time value is a Wikibase day in the Gregorian calendar', () => {
  const v = timeValue(new Date('2026-01-05T23:30:00Z'));

  assert.equal(v.time, '+2026-01-05T00:00:00Z');
  assert.equal(v.precision, 11);
  assert.equal(v.calendarmodel, 'http://www.wikidata.org/entity/Q1985727');
});

test('a time value reads the day in UTC, so the time zone cannot shift it', () => {
  // A late time on the 5th in UTC is the 6th in some time zones. Use UTC.
  const v = timeValue(new Date(Date.UTC(2026, 0, 5, 23, 59)));
  assert.equal(v.time, '+2026-01-05T00:00:00Z');
});

/* ---------- the full body ---------- */

test('the body carries the terms under the draft language', () => {
  const body = buildItemBody(draft({ lang: 'de' }));

  assert.equal(body.item.labels.de, 'Mark Twain');
  assert.equal(body.item.descriptions.de, 'author (1835-1910)');
  assert.deepEqual(body.item.aliases.de, ['Samuel Langhorne Clemens']);
});

test('an empty field is left out, so the API sees no empty string', () => {
  const body = buildItemBody(draft({ description: '', aliases: [] }));

  assert.equal('en' in body.item.descriptions, false);
  assert.equal('en' in body.item.aliases, false);
  assert.equal(body.item.labels.en, 'Mark Twain');
});

test('the aliases are copied, so a later edit cannot change the body', () => {
  const d = draft();
  const body = buildItemBody(d);
  d.aliases.push('Added later');

  assert.deepEqual(body.item.aliases.en, ['Samuel Langhorne Clemens']);
});

test('given statements replace the statements from the draft', () => {
  const only = { P244: buildStatements(draft()).P244 };
  const body = buildItemBody(draft(), { statements: only });

  assert.deepEqual(Object.keys(body.item.statements), ['P244']);
});

/* ---------- the identifiers from 024 and 053 ---------- */

test('each identifier of the draft is a statement with the reference', () => {
  const s = buildStatements(
    draft({
      identifiers: [
        { property: 'P214', value: '113230702' },
        { property: 'P1149', value: 'PS3545.I5365' },
        { property: 'P1149', value: 'ML420.C685' },
      ],
    }),
  );

  assert.equal(s.P214[0].value.content, '113230702');
  assert.deepEqual(s.P1149.map((x) => x.value.content), ['PS3545.I5365', 'ML420.C685']);
  assert.equal(s.P214[0].references[0].parts[0].property.id, 'P248');
});

test('a draft with no identifiers writes only P31 and P244', () => {
  assert.deepEqual(Object.keys(buildStatements(draft())), ['P31', 'P244']);
});
