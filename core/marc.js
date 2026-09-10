/**
 * MARCXML access primitives.
 *
 * The DOM access uses namespaces. Thus the order of the attributes and the
 * space characters in the source have no effect. The functions return repeated
 * fields and repeated subfields. The parser decodes the XML entities.
 *
 * This module contains no browser-extension APIs. It uses only the DOM. It
 * operates in each environment that has DOMParser.
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

  // DOMParser does not throw an error on a failure. It returns a document
  // that contains <parsererror>. Use getElementsByTagName and not
  // querySelector. Thus this operates with the DOM implementation that the
  // tests use outside of a browser.
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) {
    throw new Error(`Malformed MARCXML for ${id}: ${err.textContent.trim().slice(0, 200)}`);
  }

  // A correctly formed document that is not MARCXML is a different failure.
  // For some incorrect identifiers, LC sends an HTML error page and not a
  // 404 status.
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
  const all = rec.doc.getElementsByTagNameNS(MARCXML_NS, 'datafield');
  return Array.from(all).filter((el) => el.getAttribute('tag') === tag);
}

/**
 * All subfield values that have the specified code in one datafield, in order.
 *
 * A datafield can repeat a code. The 374 field usually has more than one $a
 * occupation.
 * @param {Element} field
 * @param {string} code e.g. "a", "c", "d", "q"
 * @returns {string[]}
 */
export function subfields(field, code) {
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
 * All subfields of a datafield as {code, value} pairs, in document order.
 *
 * The prototype uses this to show the unchanged shape of a field before the
 * mapping.
 * @param {Element} field
 * @returns {{code: string, value: string}[]}
 */
export function allSubfields(field) {
  const all = field.getElementsByTagNameNS(MARCXML_NS, 'subfield');
  return Array.from(all).map((el) => ({
    code: el.getAttribute('code') ?? '?',
    value: el.textContent.trim(),
  }));
}

/**
 * The indicator values for a datafield in the MARC convention. A blank
 * indicator shows as "#".
 * @param {Element} field
 * @returns {{ind1: string, ind2: string}}
 */
export function indicators(field) {
  const norm = (v) => (v === null || v.trim() === '' ? '#' : v);
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
  const all = rec.doc.getElementsByTagNameNS(MARCXML_NS, 'controlfield');
  const hit = Array.from(all).find((el) => el.getAttribute('tag') === tag);
  return hit ? hit.textContent.trim() : undefined;
}
