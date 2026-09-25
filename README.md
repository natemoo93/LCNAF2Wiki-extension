# LCNAF2Wiki Browser Extension

Turns an LCNAF authority record into the fields needed to create a Wikidata item: **Label**, **Description**, **Aliases**, and language. Each field is editable in place and copyable, with QuickStatements output for the whole item.


## Install (unpacked)

One manifest serves both browsers. Chrome reads `background.service_worker`, Firefox reads `background.scripts`, and each ignores the other's key.

### Chrome or Edge

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. **Load unpacked** → select this `LCNAF2Wiki-extension/` folder.
4. Pin the extension so its toolbar button is visible.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on**.
3. Select `manifest.json` inside this folder, or a packaged `.zip`.
4. Pin the extension so its toolbar button is visible.

Firefox 115 or later is required. A temporary add-on is removed when Firefox closes, so repeat these steps each session until the add-on is signed.

No build step. The source is plain ES modules and loads as-is; edits take effect after **Reload** on the extensions page.

## Use

Either:

- Navigate to any `id.loc.gov/authorities/names/…` page and open the popup. The identifier is detected from the URL and fetched automatically
- Open the popup anywhere and type an identifier (`n50044114`).


## What it produces

| Field | Source | Rule |
|---|---|---|
| **Label** | `100 $a` | Inverted to direct order so `ind1="0"` headings are unchanged. |
| **Description** | `374 $a` + dates | Occupations singularized and lowercased, then the years in parentheses: `author, lecturer, humorist (1835-1910)`. Either part may be absent. |
| | dates | The years are always parenthesized. With no death date, the birth year shows as `(1906-)` **only if the person was born in 1915 or earlier**; otherwise the years are omitted, for the privacy of living people. |
| **Aliases** | `400 $a` | Same inversion as the label, deduplicated, pipe-separated. Any alias identical to the label is dropped. |
| **Language** | (none) | `en` by default. |

Dates come from `046 $f`/`$g` when present and fall back to `100 $d`.

Values that need a person's judgment, such as a `$c` title, are produced flagged and editable before copying.

### Getting the result out

| Button | What it does |
|---|---|
| **Create in Wikidata** | Saves the item through the REST API after a confirm step. With the form setting chosen, opens a prefilled `Special:NewItem` instead. |
| **QuickStatements** | A v1 batch including a `P244` statement carrying the LCNAF id, so the new item records where it came from. |

#### Saving through the API

Once the desired fields have been reviewed and edited appropriately, clicking **Create in Wikidata** will open a diff panel listing every value that will be written or changed, highlighted in green, along with the account Wikidata will credit. Nothing is sent until **Create item** is pressed.

This works signed in or signed out. Signed out, the panel says the edit will carry a temporary account rather than a name.

What a save writes:

| Part | Value |
|---|---|
| Label, description, aliases | The fields as edited in the popup |
| `P244` | The LCNAF id, referenced with `P248` (LC Name Authority File) and `P813` (retrieved) |
| `P31` | `Q5`, human |
| Edit summary | `Created from LCNAF <id> with LCNAF2Wiki` |


#### Adding to an item that exists

When the duplicate check finds an item, the tool reads it and compares. If the record holds nothing the item lacks, the button reads **Entry exists** and only opens it. If the record holds more, the button reads **Add to Q…** and offers the difference:

```
Add to Q42?

    Label              Douglas Adams                    (already there)
    Description        author, humorist (1952-2001)     (kept: British science
                                                         fiction writer …)
  + Alias              Adams, Douglas
  + LCNAF ID (P244)    n80076765

  [ Add ]   Open item ↗   [ Cancel ]
```

A line with a green `+` is written. A grey line is not, and says why.

**The tool never removes anything.** A label, a description or a statement property the item already fills is left exactly as it is, even where the record disagrees. Careful human review is strongly advised when using this feature.

### Settings

Settings can be adjusted on: **Extensions → LCNAF2Wiki → Details → Extension options**, or the **Settings** link in the popup footer. Changes save immediately and take effect on the next click.

| Setting | Default | What it does |
|---|---|---|
| **Text filters** | (none) | Under Advanced. Replace text as it is read from the record. Refer to [Text filters](#text-filters). |
| **A different OAuth client** | (empty) | Under Advanced. Will be expanded once an OAuth consumer token is granted for this extension. |
| **How an item is saved** | Through the API | Whether **Create in Wikidata** saves through the REST API under your account, or opens a prefilled `Special:NewItem`. |
| **Check for duplicates first** | On | Before unlocking **Create in Wikidata**, search Wikidata for an item that already exists. |

Changing the client id signs you out, because a token belongs to the client that issued it.

The check runs in order, stopping at the first thing it finds:

| Step | Searches | Strength |
|---|---|---|
| 1 | `P244` for the LCNAF id | Proof |
| 2 | `P214` for the VIAF number from `024`, if the record carries one | Proof |
| 3 | Label and both years, for an item with no `P244` or `P214` | Evidence |


When a match is found, **Create in Wikidata** turns yellow and reads **Entry exists** or **Add to Entry**, naming the matching item in its tooltip. When the `P244` search finds nothing, the Wikidata query service looks for a person with the same label and both years, and with no `P244` of their own. If one is found, the button turns amber with a dashed border and reads **Possible match**.

## What it shows

Below the derived fields, each MARC tag is one colour-coded chip:

| Chip | Meaning |
|---|---|
| **Green** | Present and reads straightforwardly. |
| **Grey** | Not in present this record. |
| **Yellow** `i` | Present, but human review suggested.|
| **Red** `!` | The record shape is a problem for building an item. |

The `024` field is read but has no chip: it holds no name text, and what it contributes is the duplicate check rather than a field of the draft. A chip shows its count when a tag repeats (`400 ×3`). Click on a chip to preview its detail; click to pin it open so the text can be read and copied.

### Text filters

LC sends text that a browser cannot always show. A filter can do that replacement once, under **Advanced** in the settings.

Each row is a pair. **replace:** is the text to find, **with:** is what to put in its place; leaving **with:** empty removes the text. The plus button adds a row and the × removes one, and a change saves as it is typed.

```
replace: [ MacManus        ]   with: [ McManus         ]  ×
replace: [ ﷽              ]   with: [                 ]  ×

                                           + Add a filter
```

Filters run in order against the name, the variant names and the occupations, before the fields are built, so one filter covers the label and every alias that holds the same text. Filters do not touch the MARC chips, which show the record as it arrived. A value the tool changed and the chip that shows the original can be compared side by side.

## Layout

```
core/                 no chrome.* APIs 
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
  filters.js          literal find-and-replace over the record text
  identifiers.js      024 external identifiers: VIAF and Wikidata
  diff.js             what a record adds to an item that exists
  wikidata.js         P244 and P214 duplicate check
  namematch.js        name and date check, for records with no P244 or VIAF match
  wikibase.js         REST API write client
  statements.js       draft -> P244 and P31 statements, with references
  oauth.js            OAuth 2 with PKCE: URLs, challenge, token trade
  auth.js             the session: storage, refresh, sign in and out
  settings.js         chrome.storage.sync settings, with defaults
background.js         service worker: toolbar-icon click behaviour
popup/                popup.html / .css / .js, the record UI
options/              options.html / .css / .js, the settings page
manifest.json
```