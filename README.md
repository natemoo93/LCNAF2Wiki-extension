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

- Navigate to any `id.loc.gov/authorities/names/…` page and open the popup.
  The identifier is detected from the URL and fetched automatically; or
- Open the popup anywhere and type an identifier (`n50044114`).

Internal spaces are stripped automatically, so `n  83053245` works.

## What it produces

| Field | Source | Rule |
|---|---|---|
| **Label** | `100 $a` | Inverted to direct order so `ind1="0"` headings are unchanged. |
| **Description** | `374 $a` + dates | Occupations singularized and lowercased, then the years in parentheses: `author, lecturer, humorist (1835-1910)`. Either part may be absent. |
| | dates | The years are always parenthesized. With no death date, the birth year shows as `(1906-)` **only if the person was born in 1915 or earlier**; otherwise the years are omitted, for the privacy of living people. |
| **Aliases** | `400 $a` | Same inversion as the label, deduplicated, pipe-separated. Any alias identical to the label is dropped. |
| **Language** | (none) | `en` by default. |

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

### Settings

Settings live on their own page: **Extensions → LCNAF2Wiki → Details →
Extension options**, or the **Settings** link in the popup footer. Changes save
immediately and take effect on the next click.

| Setting | Default | What it does |
|---|---|---|
| **Check for duplicates first** | Off | Before unlocking **Create in Wikidata**, search Wikidata for an item that already carries this LCNAF id in `P244`. |
| **Toolbar icon click** | Open the full menu | Whether clicking the toolbar icon opens this popup, or goes straight to a prefilled `Special:NewItem`. |

An exact `P244` match is proof of a duplicate; a name match is not, since two
people can share a name. When a match is found, **Create in Wikidata** turns
grey and reads **Entry exists**, naming the matching item in its tooltip. One
click returns it to the normal create button, for cases where the existing
item's `P244` is itself wrong; a second click then creates the item.

The check fails open. If Wikidata is unreachable, rate-limits the request, or
does not answer within 6 seconds, the button returns to normal. A failed
lookup is not evidence that no item exists, and must never block a legitimate
record.



#### Toolbar icon click

**Open the full menu** (default) shows this popup, so the MARC chips and the
derived fields can be reviewed before anything reaches Wikidata.

**Create in Wikidata instantly** skips the popup: one click on the icon fetches
the record, maps it, and opens the prefilled `Special:NewItem` form, where the
fields are proofread on Wikidata's own page. Nothing is saved until Create is
pressed there.

Instant mode falls back to opening this popup when it cannot act safely:

- the page address carries no LCNAF id, so there is nothing to fetch;
- the record yields no label, so the form would be empty;
- the duplicate check is on and finds an existing item, so the **Entry exists**
  button is shown instead;
- the fetch or the mapping fails, so the error is shown.

The mode is implemented by setting or clearing the action popup in
`background.js`: a click opens a popup when one is set, and reaches the
`onClicked` handler only when none is. The manifest deliberately declares no
`default_popup`. If it did, the browser would open that popup before the
service worker had read the setting, and instant mode would never fire.

A service worker has no DOM, so `background.js` cannot use `DOMParser`. It
reads the record with `core/marcLite.js` instead, a small dependency-free
scanner. The popup keeps using `core/marc.js` and the browser's own parser. A
corpus test asserts both readers produce the same draft for every sample
record, so the icon and the popup can never disagree.

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
core/                 no chrome.* APIs; runs under Node in tests
  marc.js             MARCXML primitives (parse, datafields, subfields, indicators)
  marcLite.js         DOM-free MARCXML reader for the service worker
  extract.js          passive 100/400/374 extraction + chip status
  names.js            surname-first -> direct order
  normalize.js        LCSH occupation -> Wikidata description style
  dates.js            046 / 100$d birth and death dates
  mapper.js           record -> {label, aliases, description, lang}
  quickstatements.js  QuickStatements v1 output
  newitem.js          prefilled Special:NewItem url
  lcClient.js         single-record fetch against id.loc.gov
  wikidata.js         P244 duplicate check (fails open)
  settings.js         chrome.storage.sync settings, with defaults
background.js         service worker: toolbar-icon click behaviour
popup/                popup.html / .css / .js, the record UI
options/              options.html / .css / .js, the settings page
manifest.json
```
