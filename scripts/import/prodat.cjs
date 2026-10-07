const { createHash } = require('node:crypto');
const sax = require('sax');
const iconv = require('iconv-lite');
const unzipper = require('unzipper');

const HEADER_LIMIT = 4096;
function normalizeEncoding(value) {
  const key = value.toLowerCase().replace(/[-_]/g, '');
  return ({ utf8: 'utf-8', utf16: 'utf-16', utf16le: 'utf-16le', utf16be: 'utf-16be', windows1251: 'windows-1251', cp1251: 'windows-1251', win1251: 'windows-1251' })[key] || value.toLowerCase();
}
function detectEncoding(bytes, ended = false) {
  if (bytes.length < 4 && !ended) return null;
  const hex = bytes.subarray(0, 4).toString('hex');
  if (hex === '0000feff' || hex === 'fffe0000' || hex === '0000003c' || hex === '3c000000') throw new Error('UTF-32 XML is not supported');
  let physical;
  if (hex.startsWith('efbbbf')) physical = 'utf-8';
  else if (hex.startsWith('fffe') || hex === '3c003f00') physical = 'utf-16le';
  else if (hex.startsWith('feff') || hex === '003c003f') physical = 'utf-16be';
  const header = iconv.decode(bytes, physical || 'utf-8');
  if (!ended && '<?xml'.startsWith(header)) return null;
  const declaration = /^<\?xml\s/.test(header);
  if (declaration && !header.includes('?>')) {
    if (ended || bytes.length >= HEADER_LIMIT) throw new Error('Incomplete or oversized XML declaration');
    return null;
  }
  const match = declaration ? header.slice(0, header.indexOf('?>')).match(/\bencoding\s*=\s*(['"])([^'"]+)\1/) : null;
  const declared = match ? normalizeEncoding(match[2]) : null;
  if (physical && declared && declared !== physical && !(declared === 'utf-16' && physical.startsWith('utf-16'))) throw new Error('XML BOM/byte order conflicts with encoding declaration');
  const encoding = physical || declared || 'utf-8';
  if (!['utf-8', 'utf-16le', 'utf-16be', 'windows-1251'].includes(encoding)) throw new Error('Unsupported XML encoding: ' + encoding);
  return encoding;
}
function add(object, name, value) {
  if (!Object.hasOwn(object, name)) object[name] = value;
  else if (Array.isArray(object[name])) object[name].push(value);
  else object[name] = [object[name], value];
}
function valueOf(node) {
  const hasChildren = Object.keys(node.fields).length > 0;
  const hasAttributes = Object.keys(node.attributes).length > 0;
  if (!hasChildren && !hasAttributes) return node.text;
  const value = node.fields;
  if (hasAttributes) value['@attributes'] = node.attributes;
  if (node.text && (!hasChildren || node.text.trim())) value['#text'] = node.text;
  // Mixed content retains the relative positions of text and child elements.
  if (hasChildren && node.text.trim()) value['#content'] = node.content;
  return value;
}

// Only the current DocDetail and records from one 64 KiB chunk are retained.
// Awaiting each yielded record provides backpressure for a future DB writer.
async function* parseProdatXml(stream, { onEncoding = () => {}, onMetadata = () => {} } = {}) {
  const parser = sax.parser(true, { trim: false, normalize: false, xmlns: false });
  const names = [], nodes = [], ready = [];
  let count = 0, rootSeen = false, encoding, decoder, pending = Buffer.alloc(0);
  const metadata = Object.create(null);
  const headerFields = new Set(['DocType', 'SenderGln', 'ReceiverGln', 'Currency', 'DocumentNumber', 'DocumentDate']);
  parser.onerror = error => { throw error; };
  parser.ondoctype = () => { throw new Error('DOCTYPE is not allowed in PRODAT'); };
  parser.onopentag = tag => {
    if (names.length === 0) {
      if (rootSeen || tag.name !== 'Document') throw new Error('Expected one Document root');
      rootSeen = true;
    }
    const isRecord = tag.name === 'DocDetail' && names.length === 1;
    if (tag.name === 'DocDetail' && !isRecord) throw new Error('DocDetail must be a direct child of Document');
    names.push(tag.name);
    if (isRecord || nodes.length || (names.length === 2 && headerFields.has(tag.name))) nodes.push({ name: tag.name, fields: Object.create(null), attributes: Object.assign(Object.create(null), tag.attributes), text: '', content: [] });
  };
  const appendText = text => {
    const node = nodes.at(-1);
    if (!node) return;
    node.text += text;
    if (typeof node.content.at(-1) === 'string') node.content[node.content.length - 1] += text;
    else node.content.push(text);
  };
  parser.ontext = appendText;
  parser.oncdata = appendText;
  parser.onclosetag = () => {
    names.pop();
    if (!nodes.length) return;
    const node = nodes.pop(), value = valueOf(node), parent = nodes.at(-1);
    if (parent) {
      add(parent.fields, node.name, value);
      parent.content.push({ name: node.name, value });
    } else if (node.name === 'DocDetail') ready.push({ record: value, index: ++count });
    else add(metadata, node.name, value);
  };
  const startDecoder = ended => {
    encoding = detectEncoding(pending, ended);
    if (!encoding) return false;
    onEncoding(encoding);
    if (encoding === 'windows-1251') decoder = iconv.getDecoder(encoding);
    else {
      const strict = new TextDecoder(encoding, { fatal: true });
      decoder = { write: bytes => strict.decode(bytes, { stream: true }), end: () => strict.decode() };
    }
    parser.write(decoder.write(pending));
    pending = Buffer.alloc(0);
    return true;
  };
  for await (const chunk of stream) {
    if (!Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) throw new Error('Expected a binary XML stream');
    for (let offset = 0; offset < chunk.length;) {
      const size = decoder ? 65536 : HEADER_LIMIT - pending.length;
      const part = chunk.subarray(offset, offset + size);
      offset += part.length;
      if (!decoder) { pending = Buffer.concat([pending, part]); startDecoder(false); }
      else parser.write(decoder.write(part));
      for (const item of ready) yield item;
      ready.length = 0;
    }
  }
  if (!decoder) startDecoder(true);
  parser.write(decoder.end() || '');
  parser.close();
  if (!rootSeen) throw new Error('Missing Document root');
  onMetadata({ ...metadata, encoding });
  for (const item of ready) yield item;
}
async function* readProdatZip(zipPath, options = {}) {
  const directory = await unzipper.Open.file(zipPath);
  const entries = directory.files.filter(entry => entry.type !== 'Directory' && /\.xml$/i.test(entry.path));
  if (!entries.length) throw new Error('No XML entries in ' + zipPath);
  for (const entry of entries) {
    for await (const item of parseProdatXml(entry.stream(), { onEncoding: encoding => options.onEncoding?.({ zipPath, xmlName: entry.path, encoding }), onMetadata: metadata => options.onMetadata?.({ ...metadata, zipPath, xmlName: entry.path }) })) {
      yield { ...item, source: { zipPath, xmlName: entry.path, index: item.index } };
    }
  }
}
function getText(value) {
  if (typeof value === 'string') return value.trim();
  if (value && !Array.isArray(value) && typeof value === 'object') return getText(value['#text'] ?? value.Value);
  return null;
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
class ProdatDeduplicator {
  constructor() { this.seen = new Map(); this.rawRecords = 0; this.identicalDuplicates = 0; this.conflicts = 0; }
  accept(record, source) {
    this.rawRecords++;
    const code = getText(record?.SenderPrdCode);
    if (!code) throw new Error('Missing or ambiguous SenderPrdCode at ' + JSON.stringify(source));
    const hash = createHash('sha256').update(canonical(record)).digest('hex');
    const first = this.seen.get(code);
    if (!first) { this.seen.set(code, { hash, source }); return { kind: 'unique', code }; }
    if (first.hash === hash) { this.identicalDuplicates++; return { kind: 'identical', code }; }
    this.conflicts++;
    return { kind: 'conflict', code, first: first.source, current: source, firstHash: first.hash, currentHash: hash };
  }
  summary() { return { rawRecords: this.rawRecords, uniqueSenderPrdCode: this.seen.size, identicalDuplicates: this.identicalDuplicates, conflicts: this.conflicts }; }
}
module.exports = { parseProdatXml, readProdatZip, getText, ProdatDeduplicator };
