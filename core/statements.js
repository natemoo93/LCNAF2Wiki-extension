/**
 * Draft to Wikibase statements. Pure: a draft in, a statement body out.
 *
 * Only what the record states is written. The tool writes the LCNAF
 * identifier and "instance of: human", both of which follow from the record
 * being a personal-name authority. Dates and occupations stay in the
 * description, where a cataloguer reads them, because a date needs a
 * precision judgment and an occupation needs a term-to-item mapping that no
 * authority record carries.
 */

/** The Wikidata property for the Library of Congress authority ID. */
export const P_LC_AUTHORITY = 'P244';

/** "instance of", and the item for a human being. */
export const P_INSTANCE_OF = 'P31';
export const Q_HUMAN = 'Q5';

/** "stated in", and the item for the LC Name Authority File. */
const P_STATED_IN = 'P248';
const Q_LCNAF = 'Q13219454';

/** "retrieved", the date the record was read. */
const P_RETRIEVED = 'P813';

/** Wikidata records a time against the proleptic Gregorian calendar. */
const CALENDAR_GREGORIAN = 'http://www.wikidata.org/entity/Q1985727';

/** The precision number for a whole day. */
const PRECISION_DAY = 11;

/**
 * Build the statements for a new item.
 * The shape is the one the REST API takes: a map of property id to a list
 * of statements.
 *
 * @param {import('./mapper.js').WikidataDraft} draft
 * @param {{now?: Date}} [opts] the moment of retrieval, for the tests
 * @returns {Record<string, object[]>}
 */
export function buildStatements(draft, opts = {}) {
  const statements = {};

  // Every LCNAF personal name is a human. The 100 field is what says so,
  // and mapRecord warns when the record is a 110 or a 111 instead.
  statements[P_INSTANCE_OF] = [
    {
      property: { id: P_INSTANCE_OF },
      value: { type: 'value', content: Q_HUMAN },
    },
  ];

  // The identifier, with a reference saying where it was read and when.
  // Without the reference the claim is unsourced, which a reviewer asks about.
  if (draft.lcnafId) {
    statements[P_LC_AUTHORITY] = [
      {
        property: { id: P_LC_AUTHORITY },
        value: { type: 'value', content: draft.lcnafId },
        references: [reference(opts.now ?? new Date())],
      },
    ];
  }

  return statements;
}

/**
 * The reference: stated in the LC Name Authority File, retrieved today.
 *
 * @param {Date} now
 * @returns {{parts: object[]}}
 */
function reference(now) {
  return {
    parts: [
      {
        property: { id: P_STATED_IN },
        value: { type: 'value', content: Q_LCNAF },
      },
      {
        property: { id: P_RETRIEVED },
        value: { type: 'value', content: timeValue(now) },
      },
    ],
  };
}

/**
 * A Wikibase time value for a whole day.
 * The day is read in UTC, so the same record gives the same date whatever
 * the computer's time zone.
 *
 * @param {Date} date
 * @returns {{time: string, precision: number, calendarmodel: string}}
 */
export function timeValue(date) {
  const yyyy = String(date.getUTCFullYear()).padStart(4, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');

  return {
    // A Wikibase time carries a sign and a zeroed clock.
    time: `+${yyyy}-${mm}-${dd}T00:00:00Z`,
    precision: PRECISION_DAY,
    calendarmodel: CALENDAR_GREGORIAN,
  };
}

/**
 * The whole request body for creating an item.
 * A language with no value is left out, so the API sees no empty strings.
 *
 * @param {import('./mapper.js').WikidataDraft} draft
 * @param {{now?: Date}} [opts]
 * @returns {{item: object, comment: string}}
 */
export function buildItemBody(draft, opts = {}) {
  const lang = draft.lang;
  const item = { labels: {}, descriptions: {}, aliases: {}, statements: {} };

  if (draft.label) item.labels[lang] = draft.label;
  if (draft.description) item.descriptions[lang] = draft.description;
  if (draft.aliases?.length) item.aliases[lang] = [...draft.aliases];

  item.statements = buildStatements(draft, opts);

  return {
    item,
    // The comment is what a watchlist shows, so it names the source record.
    comment: draft.lcnafId
      ? `Created from LCNAF ${draft.lcnafId} with LCNAF2Wiki`
      : 'Created with LCNAF2Wiki',
  };
}

/**
 * A plain reading of what an item body writes, for the confirm step.
 * The user sees this, so it holds no shape the API needs.
 *
 * @param {import('./mapper.js').WikidataDraft} draft
 * @returns {{name: string, value: string}[]}
 */
export function summarize(draft) {
  const rows = [
    { name: 'Label', value: draft.label },
    { name: 'Description', value: draft.description },
    { name: 'Aliases', value: draft.aliases?.join(' | ') },
    { name: 'Language', value: draft.lang },
    { name: 'LCNAF ID (P244)', value: draft.lcnafId },
    { name: 'Instance of (P31)', value: 'human' },
  ];

  return rows.filter((r) => r.value);
}
