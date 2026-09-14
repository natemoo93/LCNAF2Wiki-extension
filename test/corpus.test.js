/**
 * Corpus check over the project sample data. It catches a mapping change that
 * breaks a record shape no unit test covers. It skips if the file is absent.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';

globalThis.DOMParser = DOMParser;

const { parseMarcXml } = await import('../core/marc.js');
const { mapRecord } = await import('../core/mapper.js');
const { PRIVACY_BIRTH_YEAR } = await import('../core/dates.js');
const { parseMarcLite } = await import('../core/marcLite.js');

const SAMPLE = new URL(
  '../../LCNAF2Wiki-main/LCNAF2Wiki-main/Examples/sample-file-Label-Alias-Description.csv',
  import.meta.url,
);

/** A minimal RFC4180 reader. The Fetch column has commas and quotes. */
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
    // An empty Fetch cell means the download failed.
    if (!row[xmlAt]) continue;

    const id = row[idAt];
    const draft = mapRecord(parseMarcXml(row[xmlAt], id));
    mapped++;

    // A personal-name record must give a label.
    if (!draft.warnings.some((w) => w.code === 'no-personal-name')) {
      assert.ok(draft.label, `${id}: empty label`);
    }

    // A label is trimmed and single-spaced.
    assert.equal(draft.label, draft.label.trim(), `${id}: untrimmed label`);
    assert.ok(!/\s{2,}/.test(draft.label), `${id}: double space in label`);

    // Wikidata style: lowercase start, no period at the end.
    if (draft.description && draft.descriptionSource === 'occupation') {
      assert.ok(!/^[A-Z]/.test(draft.description), `${id}: capitalised description`);
      assert.ok(!draft.description.endsWith('.'), `${id}: description ends in a period`);
    }

    // No alias repeats the label or another alias.
    const seen = new Set([draft.label.toLowerCase()]);
    for (const a of draft.aliases) {
      const key = a.toLowerCase();
      assert.ok(!seen.has(key), `${id}: duplicate alias "${a}"`);
      seen.add(key);
      assert.equal(a, a.trim(), `${id}: untrimmed alias`);
    }

    // The two readers must agree, or the icon and the popup would make
    // different items.
    const lite = mapRecord(parseMarcLite(row[xmlAt], id));
    assert.deepEqual(
      { label: lite.label, description: lite.description, aliases: lite.aliases },
      { label: draft.label, description: draft.description, aliases: draft.aliases },
      `${id}: the DOM reader and marcLite.js do not agree`,
    );

    // With no death date, only a person born in PRIVACY_BIRTH_YEAR or
    // before may show a date.
    if (draft.descriptionSource === 'dates' && !draft.death) {
      assert.ok(
        draft.birth && draft.birth.year <= PRIVACY_BIRTH_YEAR,
        `${id}: date description with no death date for a person who can be alive`,
      );
      assert.match(
        draft.description,
        /\(\d{4}-\)$/,
        `${id}: an open birth range must end with a hyphen, in parentheses`,
      );
    }
  }

  assert.equal(mapped, 92, 'expected 92 fetchable sample records');
});
