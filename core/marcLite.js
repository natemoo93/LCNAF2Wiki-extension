/**
 * Read MARCXML in the service worker, which has no DOMParser.
 * This reader accepts the MARCXML from id.loc.gov only, not general XML.
 */

/** Decode the five XML entities and the numeric forms. */
function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (whole, body) => {
    if (body === 'amp') return '&';
    if (body === 'lt') return '<';
    if (body === 'gt') return '>';
    if (body === 'quot') return '"';
    if (body === 'apos') return "'";
    if (body[1] === 'x' || body[1] === 'X') return String.fromCodePoint(parseInt(body.slice(2), 16));
    return String.fromCodePoint(parseInt(body.slice(1), 10));
  });
}

/**
 * Read the attributes of a start tag.
 * @param {string} text the text in the tag, after the name
 * @returns {Record<string, string>}
 */
function readAttributes(text) {
  const out = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(text))) {
    out[stripPrefix(m[1])] = decodeEntities(m[3] ?? m[4] ?? '');
  }
  return out;
}

/** Remove a namespace prefix. "marcxml:datafield" gives "datafield". */
function stripPrefix(name) {
  const at = name.indexOf(':');
  return at < 0 ? name : name.slice(at + 1);
}

/**
 * Read a MARCXML string into a record.
 * @param {string} xml
 * @param {string} id the LCNAF identifier
 * @returns {{id: string, fields: object[], controls: object[], source: string}}
 * @throws {Error} when the text has no MARCXML record
 */
export function parseMarcLite(xml, id) {
  const text = String(xml ?? '');

  // A comment can contain text that looks like a tag. Remove comments first.
  const clean = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '');

  if (!/<([\w.-]+:)?record[\s>]/.test(clean)) {
    throw new Error(`The response for ${id} is not a MARCXML record.`);
  }

  const fields = [];
  const controls = [];

  // Find each datafield and the text in it.
  const dfRe = /<([\w.-]+:)?datafield\b([^>]*)>([\s\S]*?)<\/([\w.-]+:)?datafield\s*>/g;
  let m;
  while ((m = dfRe.exec(clean))) {
    const attrs = readAttributes(m[2]);
    const subfields = [];

    const sfRe = /<([\w.-]+:)?subfield\b([^>]*)>([\s\S]*?)<\/([\w.-]+:)?subfield\s*>/g;
    let s;
    while ((s = sfRe.exec(m[3]))) {
      const sa = readAttributes(s[2]);
      subfields.push({ code: sa.code ?? '?', value: decodeEntities(s[3]).trim() });
    }

    fields.push({
      tag: attrs.tag ?? '',
      ind1: attrs.ind1 ?? ' ',
      ind2: attrs.ind2 ?? ' ',
      subfields,
    });
  }

  // A controlfield has no subfield.
  const cfRe = /<([\w.-]+:)?controlfield\b([^>]*)>([\s\S]*?)<\/([\w.-]+:)?controlfield\s*>/g;
  while ((m = cfRe.exec(clean))) {
    const attrs = readAttributes(m[2]);
    controls.push({ tag: attrs.tag ?? '', value: decodeEntities(m[3]).trim() });
  }

  return { id, fields, controls, source: text };
}
