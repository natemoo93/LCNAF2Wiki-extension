import test from 'node:test';
import assert from 'node:assert/strict';
import { newItemUrl } from '../core/newitem.js';

const parse = (draft) => new URL(newItemUrl(draft));

test('builds a prefilled Special:NewItem url', () => {
  const u = parse({
    lang: 'en',
    label: 'Joyce A. Sween',
    description: 'sociologist, sociology teacher',
    aliases: ['J. Sween', 'Joyce Sween'],
  });

  assert.equal(u.origin + u.pathname, 'https://www.wikidata.org/wiki/Special:NewItem');
  assert.equal(u.searchParams.get('lang'), 'en');
  assert.equal(u.searchParams.get('label'), 'Joyce A. Sween');
  assert.equal(u.searchParams.get('description'), 'sociologist, sociology teacher');
  // Special:NewItem takes pipe-separated aliases, the draft format.
  assert.equal(u.searchParams.get('aliases'), 'J. Sween|Joyce Sween');
});

test('omits empty fields so the form keeps its placeholders', () => {
  const u = parse({ lang: 'en', label: 'A. A. Pork', description: '', aliases: [] });
  assert.equal(u.searchParams.get('label'), 'A. A. Pork');
  assert.ok(!u.searchParams.has('description'));
  assert.ok(!u.searchParams.has('aliases'));
});

test('encodes characters that occur in real headings', () => {
  const u = parse({
    lang: 'en',
    // These marks all occur in LCNAF.
    label: 'Arnolʹd Avgustovich Pork',
    description: 'dean (education)',
    aliases: ["O'Brien & Sons"],
  });

  assert.equal(u.searchParams.get('label'), 'Arnolʹd Avgustovich Pork');
  assert.equal(u.searchParams.get('description'), 'dean (education)');
  assert.equal(u.searchParams.get('aliases'), "O'Brien & Sons");
});

test('a label containing a pipe would split aliases, so document the boundary', () => {
  // A pipe inside one alias cannot round-trip.
  const u = parse({ lang: 'en', label: 'X', description: '', aliases: ['A|B'] });
  assert.equal(u.searchParams.get('aliases'), 'A|B');
});
