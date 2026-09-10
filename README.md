# LCNAF2Wiki browser extension

Turns an LCNAF authority record into the fields needed to create a Wikidata
item: **Label**, **Description**, **Aliases**, and language. Each field is
editable in place and copyable, with QuickStatements output for the whole item.

## Install (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. **Load unpacked** → select this `extension/` folder.
4. Pin the extension so its toolbar button is visible.

No build step. The source is plain ES modules and loads as-is; edits take effect
after hitting reload on the extensions page.

## Use

Either:

- Navigate to any `id.loc.gov/authorities/names/…` page and open the popup —
  the identifier is detected from the URL and fetched automatically; or
- Open the popup anywhere and type an identifier (`n50044114`).

Internal spaces are stripped automatically, so `n  83053245` works.

## What it produces

| Field | Source | Rule |
|---|---|---|
| **Label** | `100 $a` | Inverted to direct order so `ind1="0"` headings are unchanged. |
| **Description** | `374 $a` | Singularized and lowercased |
| | dates | When there is no 374: a date range, **only if a death date exists.** |
| **Aliases** | `400 $a` | Same inversion as the label, deduplicated, pipe-separated. Any alias identical to the label is dropped. |
| **Language** | — | `en` by default. |

Dates come from `046 $f`/`$g` when present and fall back to
`100 $d`.

Values that need a person's judgment, such as a `$c` title, are produced flagged and editable before
copying.

### Getting the result out

| Button | What it does |
|---|---|
| **Create in Wikidata** | Opens `Special:NewItem` with label, description, aliases and language filled in. Nothing is saved until the cataloguer reviews the form and presses Create. |
| **Copy all** | The four fields as labelled lines, plus the LCNAF id. |
| **QuickStatements** | A v1 batch including a `P244` statement carrying the LCNAF id, so the new item records where it came from. |

All three read the fields at click time, so edits made in the popup are carried
through.

## What it shows

Below the derived fields, each MARC tag is one colour-coded chip:

| Chip | Meaning |
|---|---|
| **Green** | Present and reads straightforwardly. |
| **Grey** | Not in present this record. |
| **Blue** `i` | Present, but human review suggested.|
| **Red** `!` | The record shape is a problem for building an item. |

A chip shows its count when a tag repeats (`400 ×3`). Hover or focus a chip to
preview its detail; click to pin it open so the text can be read and copied.

Detail shows the messages for that tag plus each field in conventional MARC form
(`100 1# $a Sween, Joyce A. $q (Joyce Ann), $d 1937-`). Raw MARCXML sits
collapsed at the bottom.

## Layout

```
core/                 no chrome.* APIs — runs under Node in tests
  marc.js             MARCXML primitives (parse, datafields, subfields, indicators)
  extract.js          passive 100/400/374 extraction + chip status
  names.js            surname-first -> direct order
  normalize.js        LCSH occupation -> Wikidata description style
  dates.js            046 / 100$d birth and death dates
  mapper.js           record -> {label, aliases, description, lang}
  quickstatements.js  QuickStatements v1 output
  newitem.js          prefilled Special:NewItem url
  lcClient.js         single-record fetch against id.loc.gov
popup/                popup.html / .css / .js — the only UI
test/
  fixtures/           real MARCXML
  *.test.js           one suite per module, plus a corpus check
manifest.json
```
