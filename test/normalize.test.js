import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeFromOccupations,
  isAwkwardTerm,
  normalizeOccupation,
} from '../core/normalize.js';

test('singularizes and lowercases the common case', () => {
  assert.equal(normalizeOccupation('Sociologists'), 'sociologist');
  assert.equal(normalizeOccupation('Authors'), 'author');
  assert.equal(normalizeOccupation('Judges'), 'judge');
  assert.equal(normalizeOccupation('Sociology teachers'), 'sociology teacher');
});

test('singularizes every coordinated head, not just the last word', () => {
  assert.equal(
    normalizeOccupation('Motion picture producers and directors'),
    'motion picture producer and director',
  );
  assert.equal(normalizeOccupation('Producers and directors'), 'producer and director');
});

test('singularizes the head before a parenthetical qualifier', () => {
  // The qualifier is a scope note. The head noun takes the plural form.
  assert.equal(normalizeOccupation('Deans (Education)'), 'dean (education)');
});

test('handles an LCSH subdivision', () => {
  assert.equal(normalizeOccupation('Navies--Officers'), 'navy--officer');
});

test('leaves words that only look plural alone', () => {
  assert.equal(normalizeOccupation('Medical teaching personnel'), 'medical teaching personnel');
  assert.equal(normalizeOccupation('Physics'), 'physics');
  assert.equal(normalizeOccupation('Politics'), 'politics');
  // The endings -ss, -us and -is are not plural markers.
  assert.equal(normalizeOccupation('Actress'), 'actress');
  assert.equal(normalizeOccupation('Census'), 'census');
});

test('handles -ies and -es plurals', () => {
  assert.equal(normalizeOccupation('Armies'), 'army');
  assert.equal(normalizeOccupation('Coaches'), 'coach');
});

test('handles irregular plurals', () => {
  assert.equal(normalizeOccupation('Clergy'), 'clergy');
  assert.equal(normalizeOccupation('Women'), 'woman');
});

test('joins several terms into one description', () => {
  assert.equal(
    describeFromOccupations(['Sociologists', 'Sociology teachers']),
    'sociologist, sociology teacher',
  );
});

test('drops duplicate terms across repeated fields', () => {
  assert.equal(describeFromOccupations(['Surgeons', 'Surgeons']), 'surgeon');
});

test('an empty term list yields an empty description', () => {
  assert.equal(describeFromOccupations([]), '');
  assert.equal(describeFromOccupations(undefined), '');
});

test('isAwkwardTerm marks preserved LCSH syntax', () => {
  assert.ok(isAwkwardTerm('Navies--Officers'));
  assert.ok(isAwkwardTerm('Deans (Education)'));
  assert.ok(!isAwkwardTerm('Sociologists'));
});
