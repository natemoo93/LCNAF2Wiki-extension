/**
 * MARCXML access primitives. The DOM access uses namespaces.
 * The accessors also take a record from marcLite.js, which has no `doc`.
 */

export const MARCXML_NS = 'http://www.loc.gov/MARC21/slim';

/**
 * Parse a MARCXML string into a record handle.
 * @param {string} xml
 * @param {string} id LCNAF identifier, e.g. "n50044114"
 * @returns {{id: string, doc: XMLDocument, source: string}}
 * @throws {Error} if the document is not well-formed
 */
export function parseMarcXml(xml, id) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');

  // DOMParser returns a document with <parsererror> and does not throw.
  // Use getElementsByTagName, which the test DOM also supports.
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) {
    throw new Error(`Malformed MARCXML for ${id}: ${err.textContent.trim().slice(0, 200)}`);
  }

  // LC sends an HTML error page for some identifiers, not a 404 status.
  if (doc.getElementsByTagNameNS(MARCXML_NS, 'record').length === 0) {
    throw new Error(`Response for ${id} is not a MARCXML record.`);
  }

  return { id, doc, source: xml };
}

/**
 * All datafields that have the specified MARC tag, in document order.
 * @param {{doc: XMLDocument}} rec
 * @param {string} tag e.g. "100", "400", "374"
 * @returns {Element[]}
 */
export function datafields(rec, tag) {
  // A record from marcLite.js has a `fields` array and no `doc`.
  if (rec?.fields) return rec.fields.filter((f) => f.tag === tag);

  const all = rec.doc.getElementsByTagNameNS(MARCXML_NS, 'datafield');
  return Array.from(all).filter((el) => el.getAttribute('tag') === tag);
}

/**
 * All subfield values with the specified code, in order. A datafield can
 * repeat a code: the 374 field usually has more than one $a occupation.
 * @param {Element} field
 * @param {string} code e.g. "a", "c", "d", "q"
 * @returns {string[]}
 */
export function subfields(field, code) {
  // A field from marcLite.js has a `subfields` array of {code, value}.
  if (Array.isArray(field?.subfields)) {
    return field.subfields
      .filter((s) => s.code === code)
      .map((s) => s.value.trim())
      .filter((v) => v.length > 0);
  }

  const all = field.getElementsByTagNameNS(MARCXML_NS, 'subfield');
  return Array.from(all)
    .filter((el) => el.getAttribute('code') === code)
    .map((el) => el.textContent.trim())
    .filter((v) => v.length > 0);
}

/**
 * The first subfield value that has the specified code. Undefined if there is
 * no such subfield.
 * @param {Element} field
 * @param {string} code
 * @returns {string | undefined}
 */
export function subfield(field, code) {
  return subfields(field, code)[0];
}

/**
 * All subfields as {code, value} pairs, in document order.
 * @param {Element} field
 * @returns {{code: string, value: string}[]}
 */
export function allSubfields(field) {
  if (Array.isArray(field?.subfields)) {
    return field.subfields.map((s) => ({ code: s.code, value: s.value }));
  }

  const all = field.getElementsByTagNameNS(MARCXML_NS, 'subfield');
  return Array.from(all).map((el) => ({
    code: el.getAttribute('code') ?? '?',
    value: el.textContent.trim(),
  }));
}

/**
 * The indicator values for a datafield. A blank indicator shows as "#".
 * @param {Element} field
 * @returns {{ind1: string, ind2: string}}
 */
export function indicators(field) {
  const norm = (v) => (v === null || v === undefined || v.trim() === '' ? '#' : v);

  if (Array.isArray(field?.subfields)) {
    return { ind1: norm(field.ind1), ind2: norm(field.ind2) };
  }

  return {
    ind1: norm(field.getAttribute('ind1')),
    ind2: norm(field.getAttribute('ind2')),
  };
}

/**
 * The value of a control field (001, 008, and others). Undefined if the field
 * is absent.
 * @param {{doc: XMLDocument}} rec
 * @param {string} tag
 * @returns {string | undefined}
 */
export function controlfield(rec, tag) {
  if (rec?.controls) return rec.controls.find((c) => c.tag === tag)?.value;

  const all = rec.doc.getElementsByTagNameNS(MARCXML_NS, 'controlfield');
  const hit = Array.from(all).find((el) => el.getAttribute('tag') === tag);
  return hit ? hit.textContent.trim() : undefined;
}
