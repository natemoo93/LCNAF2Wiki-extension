/**
 * Corpus check against the sample data of the project.
 *
 * This test maps each record in
 * Examples/sample-file-Label-Alias-Description.csv. It then asserts the
 * conditions that must be true for all the records. This test finds a change
 * to the mapping that breaks a record shape that no unit test includes.
 *
 * The test does not fail when the sample file is absent. Thus the suite
 * operates with the extension alone.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';

globalThis.DOMParser = DOMParser;

const { parseMarcXml } = await import('../core/marc.js');
const { mapRecord } = await import('../core/mapper.js');

const SAMPLE = new URL(
  '../../LCNAF2Wiki-main/LCNAF2Wiki-main/Examples/sample-file-Label-Alias-Description.csv',
  import.meta.url,
);

/** A minimal RFC4180 reader. The Fetch column contains commas and quotes. */
function readCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const available = existsSync(SAMPLE);

test('maps every sample record without throwing', { skip: !available && 'sample CSV not present' }, () => {
  const rows = readCsv(readFileSync(SAMPLE, 'utf8').replace(/^﻿/, ''));
  const header = rows.shift();
  const idAt = header.indexOf('LCNAF');
  const xmlAt = header.indexOf('Fetch');

  let mapped = 0;

  for (const row of rows) {
    // An empty Fetch cell shows that the first download of the record
    // failed.
    if (!row[xmlAt]) continue;

    const id = row[idAt];
    const draft = mapRecord(parseMarcXml(row[xmlAt], id));
    mapped++;

    // A personal-name record must give a label.
    if (!draft.warnings.some((w) => w.code === 'no-personal-name')) {
      assert.ok(draft.label, `${id}: empty label`);
    }

    // A label has no space at each end and one space between the words.
    assert.equal(draft.label, draft.label.trim(), `${id}: untrimmed label`);
    assert.ok(!/\s{2,}/.test(draft.label), `${id}: double space in label`);

    // A description uses the Wikidata style. It starts with a lowercase
    // letter and has no period at the end.
    if (draft.description && draft.descriptionSource === 'occupation') {
      assert.ok(!/^[A-Z]/.test(draft.description), `${id}: capitalised description`);
      assert.ok(!draft.description.endsWith('.'), `${id}: description ends in a period`);
    }

    // An alias is not the same as the label or as a different alias.
    const seen = new Set([draft.label.toLowerCase()]);
    for (const a of draft.aliases) {
      const key = a.toLowerCase();
      assert.ok(!seen.has(key), `${id}: duplicate alias "${a}"`);
      seen.add(key);
      assert.equal(a, a.trim(), `${id}: untrimmed alias`);
    }

    // Do not use only a birth date as a description.
    if (draft.descriptionSource === 'dates') {
      assert.ok(draft.death, `${id}: date description without a death date`);
    }
  }

  assert.equal(mapped, 92, 'expected 92 fetchable sample records');
});
