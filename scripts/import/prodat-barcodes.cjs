'use strict';

const BARCODE_LAYER = 'ean-v1';
const list = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
function barcodeError(code, message, details) { return Object.assign(new Error(message), {code, details}); }
function validGtinChecksum(value) {
  if (!/^\d+$/.test(value) || ![8,12,13,14].includes(value.length)) return false;
  let sum=0, weight=3;
  for(let i=value.length-2;i>=0;i--) { sum+=(value.charCodeAt(i)-48)*weight; weight=4-weight; }
  return (10-sum%10)%10 === value.charCodeAt(value.length-1)-48;
}
function normalizeBarcodes(ean) {
  const rows=[], issues=[], seen=new Map();
  const stats={entries:0,empty:0,duplicates:0};
  const warn=(code,message,details)=>issues.push({severity:'WARNING',code,message,details});
  for(const container of list(ean)) {
    if(container==='') continue;
    if(!container || typeof container!=='object' || Array.isArray(container) || Object.keys(container).some(k=>!['Value','Description'].includes(k))) {
      throw barcodeError('BARCODE_STRUCTURE','Expected EAN with Value/Description pairs',{ean});
    }
    const values=list(container.Value), descriptions=list(container.Description);
    if(values.length!==descriptions.length) throw barcodeError('BARCODE_PAIR_MISMATCH','EAN.Value and EAN.Description lengths differ',{ean});
    for(let i=0;i<values.length;i++) {
      const raw=values[i], description=descriptions[i], sortOrder=stats.entries++;
      if(typeof raw!=='string' || typeof description!=='string') throw barcodeError('BARCODE_STRUCTURE','EAN.Value/Description must be strings',{ean,index:i});
      const barcode=raw.trim(), type=description.trim().normalize('NFC') || null;
      if(!barcode) { stats.empty++; warn('BARCODE_EMPTY','Empty barcode omitted',{raw,description,index:sortOrder}); continue; }
      if(raw!==barcode) warn('BARCODE_WHITESPACE','Outer whitespace removed; digits preserved',{raw,barcode,index:sortOrder});
      if(!/^\d+$/.test(barcode)) warn('BARCODE_NON_DIGIT','Non-digit barcode preserved without correction',{barcode,index:sortOrder});
      else if(![8,12,13,14].includes(barcode.length)) warn('BARCODE_LENGTH','Nonstandard GTIN length preserved without padding/truncation',{barcode,length:barcode.length,index:sortOrder});
      else if(!validGtinChecksum(barcode)) warn('BARCODE_CHECKSUM','GTIN check digit mismatch; original barcode preserved',{barcode,index:sortOrder});
      if(seen.has(barcode)) {
        const first=seen.get(barcode);
        if(first.type!==type) throw barcodeError('BARCODE_DESCRIPTION_CONFLICT','One product barcode has conflicting descriptions',{barcode,first,current:{type,sortOrder}});
        stats.duplicates++;warn('BARCODE_DUPLICATE','Repeated barcode within product omitted',{barcode,firstIndex:first.sortOrder,index:sortOrder});continue;
      }
      const row={barcode,type,sortOrder};seen.set(barcode,row);rows.push(row);
    }
  }
  return {rows,issues,stats};
}
module.exports={BARCODE_LAYER,normalizeBarcodes,validGtinChecksum};
