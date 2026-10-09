'use strict';
const fs = require('node:fs');
const unzipper = require('unzipper');
const { parseDocumentXml } = require('./prodat.cjs');
function documentMetadata(metadata) {
  const raw=metadata.DocumentDate;
  if(typeof raw!=='string' || !/^\d{14}$/.test(raw))throw new Error('Expected 14-digit PRICAT DocumentDate');
  const iso=`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}T${raw.slice(8,10)}:${raw.slice(10,12)}:${raw.slice(12,14)}.000Z`;
  const date=new Date(iso);
  if(!Number.isFinite(+date) || date.toISOString()!==iso)throw new Error('Invalid PRICAT DocumentDate');
  return {...metadata,documentDate:iso};
}

// The existing SAX reader is a Document/DocDetail reader; it retains one chunk,
// decodes declared encodings strictly and rejects DTDs. Both import modes use it.
async function* readPricat(file, options = {}) {
  const entries = /\.zip$/i.test(file)
    ? (await unzipper.Open.file(file)).files.filter(e => e.type !== 'Directory' && /\.xml$/i.test(e.path))
    : [{ path: file, stream: () => fs.createReadStream(file) }];
  if (!entries.length) throw new Error('No XML entries');
  for (const entry of entries) {
    for await (const item of parseDocumentXml(entry.stream(), {
      onHeader: options.onHeader,
      onMetadata: metadata => {
        if (metadata.DocType !== 'PRICAT') throw new Error('Expected DocType PRICAT');
        options.onMetadata?.(documentMetadata({ ...metadata, xmlName: entry.path }));
      },
    })) yield { ...item, xmlName: entry.path };
  }
}
module.exports = { readPricat };
