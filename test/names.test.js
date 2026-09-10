import test from 'node:test';
import assert from 'node:assert/strict';
import { invertName, stripDates, stripTrailingPunct } from '../core/names.js';

const direct = (a, opts) => invertName(a, opts).direct;

test('inverts a plain surname-first heading', () => {
  assert.equal(direct('Jones, Agnes Elizabeth,', { ind1: '1' }), 'Agnes Elizabeth Jones');
  assert.equal(direct('Dyche, Grace Locke Scripps,', { ind1: '1' }), 'Grace Locke Scripps Dyche');
  assert.equal(direct('Ahmad, Qudsia Khurshid Holozada,', { ind1: '1' }), 'Qudsia Khurshid Holozada Ahmad');
});

test('keeps the period on an initial', () => {
  // "Rothschild, Irwin B.," ends with a comma. But the period before the
  // comma is a part of the initial. Keep that period.
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
  // "King of Bavaria Ludwig II" is incorrect. But the function returns the
  // value. Thus the cataloguer can correct it in the field.
  const parsed = invertName('Ludwig II, King of Bavaria', { ind1: '1' });
  assert.equal(parsed.confidence, 'low');
  assert.match(parsed.reason, /title or epithet/i);
});

test('a surname particle does not trigger the epithet check', () => {
  // The word "von" occurs in the surname, before the comma. Thus it is not
  // proof of an epithet.
  assert.equal(invertName('Hartzhorn von Strömer, Arnold,', { ind1: '1' }).confidence, 'high');
});

test('does not place a $c title automatically', () => {
  const parsed = invertName('Rothschild, Irwin B.,', { ind1: '1', titleWords: 'III,' });
  assert.equal(parsed.direct, 'Irwin B. Rothschild');
  assert.equal(parsed.confidence, 'low');
  assert.match(parsed.reason, /not placed automatically/i);
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
