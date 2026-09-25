/**
 * Make Wikibase statements from a draft.
 * Write only the LCNAF identifier and "instance of: human".
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

/** Wikidata records a time in the proleptic Gregorian calendar. */
const CALENDAR_GREGORIAN = 'http://www.wikidata.org/entity/Q1985727';

/** The precision number for a whole day. */
const PRECISION_DAY = 11;

/**
 * Make the statements for a new item.
 * The result maps each property ID to a list of statements, for the REST API.
 * @param {import('./mapper.js').WikidataDraft} draft
 * @param {{now?: Date}} [opts] the moment of retrieval, for the tests
 * @returns {Record<string, object[]>}
 */
export function buildStatements(draft, opts = {}) {
  const statements = {};

  // Each LCNAF personal name is a human.
  // mapRecord gives a warning if the record is a 110 or a 111.
  statements[P_INSTANCE_OF] = [
    {
      property: { id: P_INSTANCE_OF },
      value: { type: 'value', content: Q_HUMAN },
    },
  ];

  // Add the identifier with a reference to the source and the date.
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
 * Make the reference: stated in the LC Name Authority File, retrieved today.
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
 * Make a Wikibase time value for a whole day.
 * Use UTC, so that the time zone does not change the date.
 * @param {Date} date
 * @returns {{time: string, precision: number, calendarmodel: string}}
 */
export function timeValue(date) {
  const yyyy = String(date.getUTCFullYear()).padStart(4, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');

  return {
    // A Wikibase time has a sign and a time of zero.
    time: `+${yyyy}-${mm}-${dd}T00:00:00Z`,
    precision: PRECISION_DAY,
    calendarmodel: CALENDAR_GREGORIAN,
  };
}

/**
 * Make the full request body to create an item.
 * Omit a language that has no value. Do not send empty strings.
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
    // A watchlist shows the comment. It names the source record.
    comment: draft.lcnafId
      ? `Created from LCNAF ${draft.lcnafId} with LCNAF2Wiki`
      : 'Created with LCNAF2Wiki',
  };
}

/**
 * Make a list of the values that a save writes, for the confirm step.
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
