# LCNAF2Wiki Browser Extension

Turns an LCNAF authority record into the fields needed to create a Wikidata
item: **Label**, **Description**, **Aliases**, and language. Each field is
editable in place and copyable, with QuickStatements output for the whole item.


## Install (unpacked)

One manifest serves both browsers. Chrome reads `background.service_worker`,
Firefox reads `background.scripts`, and each ignores the other's key.

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

Firefox 115 or later is required. A temporary add-on is removed when Firefox
closes, so repeat these steps each session until the add-on is signed.

No build step. The source is plain ES modules and loads as-is; edits take effect
after **Reload** on the extensions page.

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
| **Create in Wikidata** | Saves the item through the REST API after a confirm step. With the form setting chosen, opens a prefilled `Special:NewItem` instead. |
| **QuickStatements** | A v1 batch including a `P244` statement carrying the LCNAF id, so the new item records where it came from. |

#### Saving through the API

A save through the REST API is **immediate and public**. There is no review
page between the click and the edit, so the extension puts one there: a confirm
panel lists every value that will be written, says who the edit will be
credited to, and waits. Nothing is sent until **Create item** is pressed.

This works signed in or signed out. Signed out, the panel says the edit will
carry a temporary account rather than a name.

What a save writes:

| Part | Value |
|---|---|
| Label, description, aliases | The fields as edited in the popup |
| `P244` | The LCNAF id, referenced with `P248` (LC Name Authority File) and `P813` (retrieved) |
| `P31` | `Q5`, human |
| Edit summary | `Created from LCNAF <id> with LCNAF2Wiki` |

Dates and occupations stay in the description and are **not** written as
statements. A date needs a precision judgment the record does not carry, and an
occupation needs a term-to-item mapping that an authority record does not
supply. Writing either from a guess would put a wrong claim in a public
database, which costs more to undo than to never make.


#### Adding to an item that exists

When the duplicate check finds an item, the tool reads it and compares. If the
record holds nothing the item lacks, the button reads **Entry exists** and only
opens it. If the record holds more, the button reads **Add to Q…** and offers
the difference:

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

**The tool never removes anything.** A label, a description or a statement
property the item already fills is left exactly as it is, even where the
record disagrees, because the record is one source among several and the item
can hold work the tool knows nothing about. Replacing a value is a judgment
for a cataloguer on Wikidata, not for this tool.

After a save the button reads the new Q-number and stays disabled, so a second
press cannot make a duplicate. A failed save leaves the draft untouched, so
nothing typed is lost; an expired sign-in says so and asks for another.

All three read the fields at click time, so edits made in the popup are carried
through.

### Settings

Settings live on their own page: **Extensions → LCNAF2Wiki → Details →
Extension options**, or the **Settings** link in the popup footer. Changes save
immediately and take effect on the next click.

| Setting | Default | What it does |
|---|---|---|
| **A different OAuth client** | (empty) | Under Advanced. Only for signing in through an institutional client. Refer to [Signing in](#signing-in). |
| **How an item is saved** | Through the API | Whether **Create in Wikidata** saves through the REST API under your account, or opens a prefilled `Special:NewItem`. |
| **Check for duplicates first** | On | Before unlocking **Create in Wikidata**, search Wikidata for an item that already carries this LCNAF id in `P244`, then for a person with the same name and years. |
| **Toolbar icon click** | Open the full menu | Whether clicking the toolbar icon opens this popup, or goes straight to a prefilled `Special:NewItem`. |

Changing the client id signs you out, because a token belongs to the client
that issued it.

The check runs in order, stopping at the first thing it finds:

| Step | Searches | Strength |
|---|---|---|
| 1 | `P244` for the LCNAF id | Proof |
| 2 | `P214` for the VIAF number from `024`, if the record carries one | Proof |
| 3 | Label and both years, for an item with no `P244` | Evidence |

An exact identifier match is proof of a duplicate; a name match is not, since
two people can share a name.

Both years must be present, and each may differ by one, because catalogues
disagree about a birth or death year by a year often enough to matter. A
record with no death year, such as a living person, skips this check, since a
name and one year is too weak to show anyone.

The check fails open. If Wikidata is unreachable, rate-limits the request, or
does not answer in time, the button returns to normal. A failed lookup is not
evidence that no item exists, and must never block a legitimate record.




## What it shows

Below the derived fields, each MARC tag is one colour-coded chip:

| Chip | Meaning |
|---|---|
| **Green** | Present and reads straightforwardly. |
| **Grey** | Not in present this record. |
| **Yellow** `i` | Present, but human review suggested.|
| **Red** `!` | The record shape is a problem for building an item. |

The `024` field is read but has no chip: it holds no name text, and what it
contributes is the duplicate check rather than a field of the draft.

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
  identifiers.js      024 external identifiers: VIAF and Wikidata
  diff.js             what a record adds to an item that exists
  wikidata.js         P244 and P214 duplicate check (fails open)
  namematch.js        name and date check, for records with no P244 match
  wikibase.js         REST API write client; refuses a write with no token
  statements.js       draft -> P244 and P31 statements, with references
  oauth.js            OAuth 2 with PKCE: URLs, challenge, token trade
  auth.js             the session: storage, refresh, sign in and out
  settings.js         chrome.storage.sync settings, with defaults
background.js         service worker: toolbar-icon click behaviour
popup/                popup.html / .css / .js, the record UI
options/              options.html / .css / .js, the settings page
manifest.json
package.json          the test runner and its one dev dependency
```
