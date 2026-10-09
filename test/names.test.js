import test from 'node:test';
import assert from 'node:assert/strict';
import { invertName, looksRomanized, stripDates, stripTrailingPunct } from '../core/names.js';

const direct = (a, opts) => invertName(a, opts).direct;

test('inverts a plain surname-first heading', () => {
  assert.equal(direct('Jones, Agnes Elizabeth,', { ind1: '1' }), 'Agnes Elizabeth Jones');
  assert.equal(direct('Dyche, Grace Locke Scripps,', { ind1: '1' }), 'Grace Locke Scripps Dyche');
  assert.equal(direct('Ahmad, Qudsia Khurshid Holozada,', { ind1: '1' }), 'Qudsia Khurshid Holozada Ahmad');
});

test('keeps the period on an initial', () => {
  // In "Rothschild, Irwin B.," the period is part of the initial.
  assert.equal(direct('Rothschild, Irwin B.,', { ind1: '1' }), 'Irwin B. Rothschild');
  assert.equal(direct('Sween, Joyce A.', { ind1: '1' }), 'Joyce A. Sween');
  assert.equal(direct('Jung, F. T.,', { ind1: '1' }), 'F. T. Jung');
  assert.equal(direct('Hale, G. E.', { ind1: '1' }), 'G. E. Hale');
});

test('keeps a multi-word surname together', () => {
  assert.equal(
    direct('Hartzhorn von Strömer, Arnold,', { ind1: '1' }),
    'Arnold Hartzhorn von Strömer',
  );
});

test('ind1="0" is already direct order and passes through', () => {
  assert.equal(direct('Aristotle', { ind1: '0' }), 'Aristotle');
  const parsed = invertName('Aristotle', { ind1: '0' });
  assert.equal(parsed.confidence, 'high');
});

test('strips dates carried inside $a', () => {
  assert.equal(direct('Smith, John, 1832-1901', { ind1: '1' }), 'John Smith');
  assert.equal(stripDates('Smith, John, 1832-1901'), 'Smith, John');
  assert.equal(stripDates('Smith, John, 1937-'), 'Smith, John');
});

test('flags an epithet rather than inverting it silently', () => {
  // The value is not correct, but the function returns it so that a person can correct it.
  const parsed = invertName('Ludwig II, King of Bavaria', { ind1: '1' });
  assert.equal(parsed.confidence, 'low');
  assert.match(parsed.reason, /title or epithet/i);
});

test('a surname particle does not trigger the epithet check', () => {
  // "von" is in the surname, before the comma, so it is not an epithet.
  assert.equal(invertName('Hartzhorn von Strömer, Arnold,', { ind1: '1' }).confidence, 'high');
});

test('does not place a $c title automatically', () => {
  const parsed = invertName('Rothschild, Irwin B.,', { ind1: '1', titleWords: 'III,' });
  assert.equal(parsed.direct, 'Irwin B. Rothschild');
  assert.equal(parsed.confidence, 'low');
  assert.match(parsed.reason, /in position manually/i);
});

test('ignores a $c that is only a qualifier in parentheses', () => {
  const parsed = invertName('Schneeweis, Patrick', { ind1: '1', titleWords: '(Musician),' });
  assert.equal(parsed.direct, 'Patrick Schneeweis');
  assert.equal(parsed.confidence, 'high');
  assert.equal(invertName('Smith, John', { ind1: '1', titleWords: 'Sir (Musician),' }).confidence, 'low');
});

test('flags a surname-first heading with no comma', () => {
  const parsed = invertName('Cher', { ind1: '1' });
  assert.equal(parsed.direct, 'Cher');
  assert.equal(parsed.confidence, 'low');
});

test('handles an empty or missing $a', () => {
  assert.equal(invertName(undefined).direct, '');
  assert.equal(invertName('').confidence, 'low');
});

test('stripTrailingPunct leaves internal punctuation alone', () => {
  assert.equal(stripTrailingPunct('Barker, Margery,'), 'Barker, Margery');
  assert.equal(stripTrailingPunct('Sween, Joyce A.'), 'Sween, Joyce A.');
});

/* ---------- the Arabic comma ---------- */

test('inverts a heading that uses the Arabic comma', () => {
  // LC writes Arabic-script headings with U+060C, not with the ASCII comma.
  assert.equal(direct('تواين، مارک', { ind1: '1' }), 'مارک تواين');
  assert.equal(invertName('تواين، مارک', { ind1: '1' }).confidence, 'high');
});

test('removes an Arabic comma at the end', () => {
  assert.equal(direct('توين، مارك،', { ind1: '1' }), 'مارك توين');
  assert.equal(stripTrailingPunct('توين، مارك،'), 'توين، مارك');
});

test('counts an Arabic comma as a second comma', () => {
  assert.equal(invertName('Smith، John, Jr.', { ind1: '1' }).confidence, 'low');
});

test('removes a date range after an Arabic comma', () => {
  assert.equal(stripDates('توين، مارك، 1835-1910'), 'توين، مارك');
});

/* ---------- CJK names ---------- */

test('does not flag a CJK name with no comma', () => {
  // Chinese, Japanese, and Korean write a foreign name as one unit.
  for (const name of ['馬克吐温,', 'マーク・トウェイン', '마크 트웨인']) {
    const parsed = invertName(name, { ind1: '1' });
    assert.equal(parsed.confidence, 'high', name);
    assert.equal(parsed.reason, undefined, name);
  }
  assert.equal(direct('馬克吐温,', { ind1: '1' }), '馬克吐温');
});

test('still flags a Latin-script name with no comma', () => {
  assert.equal(invertName('Cher', { ind1: '1' }).confidence, 'low');
});

/* ---------- romanizations ---------- */

test('finds ALA-LC romanizations', () => {
  for (const name of ['Mārk Tuwayn', 'Mark Tuėĭn', 'Ma-kʻo Tʻu-wen', 'Marḳ Ṭṿeyn', 'Mak\'ŭ T\'ŭwein', 'Makū Touen']) {
    assert.equal(looksRomanized(name), true, name);
  }
});

test('does not mark usual names as romanizations', () => {
  for (const name of ['Mark Twain', 'Marek Twain', 'Antonín Dvořák', 'José Martí', 'Nguyễn Văn Thiệu']) {
    assert.equal(looksRomanized(name), false, name);
  }
});

test('does not mark a name in another script as a romanization', () => {
  // The Cyrillic letter й has a breve in NFD.
  for (const name of ['Марк Твен', 'Марк Твэн й', 'מרק טוין', '馬克吐温']) {
    assert.equal(looksRomanized(name), false, name);
  }
});
