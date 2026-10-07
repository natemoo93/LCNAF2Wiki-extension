/**
 * Test the text filters. A filter is literal text, not a pattern.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { applyFilters, cleanFilters, describeFilter, MAX_FILTERS, MAX_FILTER_LENGTH } =
  await import('../core/filters.js');

/* ---------- applying ---------- */

test('a filter replaces every occurrence', () => {
  const out = applyFilters('aXbXc', [{ replace: 'X', with: '-' }]);
  assert.equal(out, 'a-b-c');
});

test('filters run in the order they are given', () => {
  // The second filter operates on the result of the first filter.
  const out = applyFilters('a', [
    { replace: 'a', with: 'b' },
    { replace: 'b', with: 'c' },
  ]);
  assert.equal(out, 'c');
});

test('an empty replacement removes the text', () => {
  assert.equal(applyFilters('Smith�, John', [{ replace: '�', with: '' }]), 'Smith, John');
});

test('the text to replace is literal, not a pattern', () => {
  // These characters are literal text.
  assert.equal(applyFilters('a.c', [{ replace: '.', with: '!' }]), 'a!c');
  assert.equal(applyFilters('a+b', [{ replace: '+', with: '-' }]), 'a-b');
  assert.equal(applyFilters('(x)', [{ replace: '(x)', with: 'y' }]), 'y');
  assert.equal(applyFilters('a$1b', [{ replace: '$1', with: 'Z' }]), 'aZb');
});

test('a dollar sign in the replacement is literal too', () => {
  // String.replace reads $& as the match. split/join does not.
  assert.equal(applyFilters('ab', [{ replace: 'a', with: '$&' }]), '$&b');
});

test('a filter with no text to replace is skipped', () => {
  // An empty left side puts the replacement between all characters.
  assert.equal(applyFilters('abc', [{ replace: '', with: 'X' }]), 'abc');
});

test('text with no filters comes back unchanged', () => {
  assert.equal(applyFilters('abc', []), 'abc');
  assert.equal(applyFilters('abc', undefined), 'abc');
});

test('a value that is not text is returned as it is', () => {
  // A missing MARC subfield is undefined.
  assert.equal(applyFilters(undefined, [{ replace: 'a', with: 'b' }]), undefined);
  assert.equal(applyFilters('', [{ replace: 'a', with: 'b' }]), '');
});

test('a non-Latin string is replaced like any other', () => {
  const out = applyFilters('דאגלאס', [
    { replace: 'דאגלאס', with: 'Douglas' },
  ]);
  assert.equal(out, 'Douglas');
});

test('a filter that is off is not applied', () => {
  assert.equal(applyFilters('abc', [{ replace: 'a', with: 'X', enabled: false }]), 'abc');
});

test('a filter that is off does not stop the filters after it', () => {
  const out = applyFilters('ab', [
    { replace: 'a', with: 'X', enabled: false },
    { replace: 'b', with: 'Y', enabled: true },
  ]);
  assert.equal(out, 'aY');
});

/* ---------- cleaning ---------- */

test('a filter with no left side is dropped', () => {
  assert.deepEqual(cleanFilters([{ replace: '', with: 'X' }]), []);
});

test('a missing right side becomes an empty string', () => {
  assert.deepEqual(cleanFilters([{ replace: 'X' }]), [{ replace: 'X', with: '', enabled: true }]);
});

test('anything that is not a filter is dropped', () => {
  assert.deepEqual(cleanFilters([null, 'x', 7, { replace: 'a', with: 'b' }]), [
    { replace: 'a', with: 'b', enabled: true },
  ]);
});

test('a filter with no enabled value is on', () => {
  // A filter from an older version has no enabled value.
  assert.equal(cleanFilters([{ replace: 'a', with: 'b' }])[0].enabled, true);
});

test('a filter that is off stays off', () => {
  assert.equal(cleanFilters([{ replace: 'a', with: 'b', enabled: false }])[0].enabled, false);
});

test('a stored value that is not a list gives no filters', () => {
  assert.deepEqual(cleanFilters(undefined), []);
  assert.deepEqual(cleanFilters('nonsense'), []);
});

test('a filter longer than the limit is cut', () => {
  const long = 'a'.repeat(MAX_FILTER_LENGTH + 50);
  const [filter] = cleanFilters([{ replace: long, with: long }]);

  assert.equal(filter.replace.length, MAX_FILTER_LENGTH);
  assert.equal(filter.with.length, MAX_FILTER_LENGTH);
});

test('the list stops at the maximum', () => {
  const many = Array.from({ length: MAX_FILTERS + 10 }, (_, i) => ({
    replace: `x${i}`,
    with: 'y',
  }));

  assert.equal(cleanFilters(many).length, MAX_FILTERS);
});

/* ---------- describing ---------- */

test('a filter reads as one line', () => {
  assert.equal(describeFilter({ replace: 'a', with: 'b' }), 'a -> b');
});

test('a filter that removes text says so', () => {
  assert.equal(describeFilter({ replace: 'a', with: '' }), 'a -> (nothing)');
});
