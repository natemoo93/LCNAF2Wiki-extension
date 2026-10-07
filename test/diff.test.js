/**
 * Test the diff. The tool only adds data.
 * No comparison can make an operation that replaces or removes a value.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { buildAddPatch, diffAgainstItem, selectedDraft, summarizeAdditions, withhold } = await import('../core/diff.js');
const { buildStatements } = await import('../core/statements.js');

/** A draft with all fields filled in. */
function draft(over = {}) {
  return {
    lcnafId: 'n80076765',
    lang: 'en',
    label: 'Douglas Adams',
    description: 'author, humorist (1952-2001)',
    aliases: ['Douglas Noel Adams'],
    warnings: [],
    ...over,
  };
}

/** An item in the REST API format. */
function item(over = {}) {
  return { labels: {}, descriptions: {}, aliases: {}, statements: {}, ...over };
}

/** Each status in a diff, by field key. */
function byKey(diff) {
  return Object.fromEntries(diff.additions.map((c) => [c.key, c.status]));
}

/* ---------- only additions ---------- */

test('an empty item takes everything', () => {
  const d = diffAgainstItem(draft(), item(), buildStatements(draft()));
  const status = byKey(d);

  assert.equal(status.label, 'add');
  assert.equal(status.description, 'add');
  assert.equal(status['alias:Douglas Noel Adams'], 'add');
  assert.equal(status.P244, 'add');
  assert.equal(status.P31, 'add');
  assert.equal(d.hasAdditions, true);
});

test('a label the item already has is kept, never replaced', () => {
  const d = diffAgainstItem(
    draft({ label: 'Douglas Adams' }),
    item({ labels: { en: 'Douglas Noël Adams' } }),
    {},
  );

  // The values are different. The item keeps its value.
  assert.equal(byKey(d).label, 'kept');
  assert.equal(d.labels.en, undefined, 'no label is written');
});

test('a description the item already has is kept, even when it differs', () => {
  const d = diffAgainstItem(
    draft(),
    item({ descriptions: { en: 'British science fiction writer (1952-2001)' } }),
    {},
  );

  assert.equal(byKey(d).description, 'kept');
  assert.equal(d.descriptions.en, undefined);
});

test('a statement property the item already has is left alone', () => {
  const statements = buildStatements(draft());
  const d = diffAgainstItem(
    draft(),
    item({ statements: { P244: [{ value: { content: 'n12345678' } }] } }),
    statements,
  );

  // Report a different P244. Do not replace it.
  assert.equal(byKey(d).P244, 'kept');
  assert.equal(d.statements.P244, undefined);
  // Add the missing statement.
  assert.equal(byKey(d).P31, 'add');
});

test('every operation in a patch is an add', () => {
  const d = diffAgainstItem(draft(), item(), buildStatements(draft()));
  const { patch } = buildAddPatch(d, 'en', 'n80076765');

  assert.ok(patch.length > 0);
  for (const op of patch) {
    assert.equal(op.op, 'add', `found a "${op.op}" operation`);
  }
});

test('a full item yields no patch at all', () => {
  const statements = buildStatements(draft());
  const d = diffAgainstItem(
    draft(),
    item({
      labels: { en: 'Douglas Adams' },
      descriptions: { en: 'author' },
      aliases: { en: ['Douglas Noel Adams'] },
      statements: {
        P244: [{ value: { content: 'n80076765' } }],
        P31: [{ value: { content: 'Q5' } }],
      },
    }),
    statements,
  );

  assert.equal(d.hasAdditions, false);
  assert.equal(buildAddPatch(d, 'en', 'n80076765'), undefined);
});

/* ---------- aliases ---------- */

test('only the aliases the item lacks are added', () => {
  const d = diffAgainstItem(
    draft({ aliases: ['Douglas Noel Adams', 'Adams, Douglas'] }),
    item({ aliases: { en: ['Douglas Noel Adams'] } }),
    {},
  );

  assert.deepEqual(d.freshAliases, ['Adams, Douglas']);
  assert.equal(byKey(d)['alias:Douglas Noel Adams'], 'same');
  assert.equal(byKey(d)['alias:Adams, Douglas'], 'add');
});

test('an alias matching an existing one in case or spacing is not added', () => {
  const d = diffAgainstItem(
    draft({ aliases: ['douglas  noel adams'] }),
    item({ aliases: { en: ['Douglas Noel Adams'] } }),
    {},
  );

  assert.deepEqual(d.freshAliases, []);
});

test('an alias equal to the item label is not added', () => {
  // Wikidata refuses an alias that matches the label.
  const d = diffAgainstItem(
    draft({ aliases: ['Douglas Adams'] }),
    item({ labels: { en: 'Douglas Adams' } }),
    {},
  );

  assert.deepEqual(d.freshAliases, []);
});

test('a variant that the item has as an alias in another language is not added', () => {
  const d = diffAgainstItem(
    draft({ aliases: ['Дуглас Адамс', 'Adams, Douglas'] }),
    item({ aliases: { ru: ['Дуглас Адамс'] } }),
    {},
  );

  assert.deepEqual(d.freshAliases, ['Adams, Douglas']);
  const match = d.additions.find((c) => c.key === 'alias:Дуглас Адамс');
  assert.equal(match.status, 'same');
  assert.equal(match.matchLang, 'ru');
});

test('a variant that the item has as a label in another language is not added', () => {
  const d = diffAgainstItem(
    draft({ aliases: ['道格拉斯·亚当斯'] }),
    item({ labels: { zh: '道格拉斯·亚当斯' } }),
    {},
  );

  assert.deepEqual(d.freshAliases, []);
  assert.equal(d.hasAdditions, true);
});

test('a match in the draft language has no language note', () => {
  const d = diffAgainstItem(
    draft({ aliases: ['Douglas Noel Adams'] }),
    item({ aliases: { en: ['Douglas Noel Adams'], de: ['Douglas Noel Adams'] } }),
    {},
  );

  const match = d.additions.find((c) => c.key === 'alias:Douglas Noel Adams');
  assert.equal(match.matchLang, undefined);
});

test('aliases append one by one when the item already has a list', () => {
  // The item has a label and a description, so the patch has only alias operations.
  const d = diffAgainstItem(
    draft({ aliases: ['Adams, Douglas'] }),
    item({
      labels: { en: 'Douglas Adams' },
      descriptions: { en: 'author' },
      aliases: { en: ['Douglas Noel Adams'] },
    }),
    {},
  );
  const { patch } = buildAddPatch(d, 'en', 'n1');

  // The `/-` path adds to the end and does not change the list.
  assert.deepEqual(patch, [{ op: 'add', path: '/aliases/en/-', value: 'Adams, Douglas' }]);
});

test('aliases are written as a list when the item has none in that language', () => {
  const d = diffAgainstItem(
    draft({ aliases: ['A', 'B'] }),
    item({ labels: { en: 'Douglas Adams' }, descriptions: { en: 'author' } }),
    {},
  );
  const { patch } = buildAddPatch(d, 'en', 'n1');

  // There is no list, so the patch makes one.
  assert.deepEqual(patch, [{ op: 'add', path: '/aliases/en', value: ['A', 'B'] }]);
});

/* ---------- the patch shape ---------- */

test('the patch writes a label and a description at their own paths', () => {
  const d = diffAgainstItem(draft({ aliases: [] }), item(), {});
  const { patch } = buildAddPatch(d, 'en', 'n1');

  assert.deepEqual(patch, [
    { op: 'add', path: '/labels/en', value: 'Douglas Adams' },
    { op: 'add', path: '/descriptions/en', value: 'author, humorist (1952-2001)' },
  ]);
});

test('the edit comment names the source record', () => {
  const d = diffAgainstItem(draft(), item(), {});
  const { comment } = buildAddPatch(d, 'en', 'n80076765');

  assert.match(comment, /n80076765/);
});

/* ---------- the summary ---------- */

test('the summary names what would be added', () => {
  const d = diffAgainstItem(draft(), item(), buildStatements(draft()));
  const text = summarizeAdditions(d);

  assert.match(text, /Label/);
  assert.match(text, /1 alias/);
});

test('the summary of a full item says there is nothing to add', () => {
  const d = diffAgainstItem(
    draft({ label: '', description: '', aliases: [] }),
    item(),
    {},
  );

  assert.equal(summarizeAdditions(d), 'Nothing to add');
});

test('several aliases are counted, not listed', () => {
  const d = diffAgainstItem(
    draft({ label: '', description: '', aliases: ['A', 'B', 'C'] }),
    item(),
    {},
  );

  assert.equal(summarizeAdditions(d), '3 aliases');
});

/* ---------- withheld lines ---------- */

test('a withheld alias is not in the patch', () => {
  const d = diffAgainstItem(
    draft({ aliases: ['Mārk Tuwayn', 'Adams, Douglas'] }),
    item({ labels: { en: 'Douglas Adams' }, descriptions: { en: 'author' } }),
    {},
  );
  const w = withhold(d, new Set(['alias:Mārk Tuwayn']), 'en');
  const { patch } = buildAddPatch(w, 'en', 'n1');

  assert.deepEqual(patch, [{ op: 'add', path: '/aliases/en', value: ['Adams, Douglas'] }]);
  assert.equal(byKey(w)['alias:Mārk Tuwayn'], 'withheld');
});

test('a withheld label, description, and statement are not in the patch', () => {
  const d = diffAgainstItem(draft({ aliases: [] }), item(), buildStatements(draft()));
  const w = withhold(d, new Set(['label', 'description', 'P31']), 'en');
  const paths = buildAddPatch(w, 'en', 'n1').patch.map((op) => op.path);

  assert.deepEqual(paths, ['/statements/P244']);
});

test('withholding every addition leaves nothing to add', () => {
  const d = diffAgainstItem(draft({ aliases: ['A'] }), item({ labels: { en: 'Douglas Adams' }, descriptions: { en: 'x' } }), {});
  const w = withhold(d, new Set(['alias:A']), 'en');

  assert.equal(w.hasAdditions, false);
  assert.equal(buildAddPatch(w, 'en', 'n1'), undefined);
});

test('withholding nothing returns the same diff', () => {
  const d = diffAgainstItem(draft(), item(), {});
  assert.equal(withhold(d, new Set(), 'en'), d);
});

/* ---------- a new item ---------- */

test('every field of a draft is an addition to an empty item', () => {
  const d = diffAgainstItem(draft(), {}, buildStatements(draft()));

  assert.ok(d.additions.every((c) => c.status === 'add'));
  assert.deepEqual(
    d.additions.map((c) => c.key),
    ['label', 'description', 'alias:Douglas Noel Adams', 'P31', 'P244'],
  );
});

test('selectedDraft keeps only the lines that the user did not withhold', () => {
  const d = diffAgainstItem(draft({ aliases: ['A', 'B'] }), {}, buildStatements(draft()));
  const w = withhold(d, new Set(['description', 'alias:A', 'P31']), 'en');
  const { draft: chosen, statements } = selectedDraft(draft(), w);

  assert.equal(chosen.label, 'Douglas Adams');
  assert.equal(chosen.description, '');
  assert.deepEqual(chosen.aliases, ['B']);
  assert.deepEqual(Object.keys(statements), ['P244']);
});

test('a property with two values shows both, and adds both', () => {
  const statements = {
    P1149: [
      { property: { id: 'P1149' }, value: { type: 'value', content: 'PS3545.I5365' } },
      { property: { id: 'P1149' }, value: { type: 'value', content: 'ML420.C685' } },
    ],
  };
  const d = diffAgainstItem(draft(), item(), statements);
  const line = d.additions.find((c) => c.key === 'P1149');

  assert.equal(line.status, 'add');
  assert.equal(line.value, 'PS3545.I5365, ML420.C685');
  assert.equal(d.statements.P1149.length, 2);
});
