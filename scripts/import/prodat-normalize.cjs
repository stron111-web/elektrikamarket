'use strict';
const { slugify } = require('./prodat-slug.cjs');

function scalar(value, field = 'value') {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new Error(`Expected scalar ${field}`);
  return value.trim().normalize('NFC') || null;
}
function object(value, field) {
  if (value == null || value === '') return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`Expected object ${field}`);
  return value;
}
function list(value) { return value == null ? [] : Array.isArray(value) ? value : [value]; }
function strings(value, field) {
  return [...new Set(list(value).flatMap(v => {
    if (v && typeof v === 'object' && !Array.isArray(v)) return strings(v.Value, field);
    const text = scalar(v, field);
    return text ? [text] : [];
  }))].sort();
}
function decimal(value, field) {
  const text = scalar(value, field);
  if (text === null) return null;
  const match = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(text.replace(/^([+-]?)\.(?=\d)/, (_, sign) => sign + '0.'));
  if (!match) throw new Error(`Invalid decimal ${field}: ${text}`);
  const integer = match[2].replace(/^0+(?=\d)/, '');
  const fraction = (match[3] || '').replace(/0+$/, '');
  if (integer.length > 10 || fraction.length > 10) throw new Error(`Decimal(20,10) overflow ${field}: ${text}`);
  return (match[1] === '-' && (integer !== '0' || fraction) ? '-' : '') + integer + (fraction ? '.' + fraction : '');
}
function int32(value, field) {
  const text = scalar(value, field);
  if (text === null) return null;
  if (!/^\d+$/.test(text) || BigInt(text) > 2147483647n) throw new Error(`Invalid Int ${field}`);
  return Number(text); // ItemID only; physical decimals remain strings.
}
function slug(kind, name) { return slugify(name) || kind; }
function normalizeProduct(record) {
  const r = object(record, 'DocDetail');
  const supplierCode = scalar(r.SenderPrdCode, 'SenderPrdCode');
  const name = scalar(r.ProductName, 'ProductName');
  if (!supplierCode || !name) throw new Error('SenderPrdCode and ProductName are required');
  const weight = object(r.Weight, 'Weight'), dimension = object(r.Dimension, 'Dimension');
  const catalog = object(r.RsCatalog, 'RsCatalog');
  const categories = [];
  let parentKey = null;
  for (const level of [4, 3, 2]) {
    const id = scalar(catalog[`Level${level}ID`], `Level${level}ID`);
    const categoryName = scalar(catalog[`Level${level}Name`], `Level${level}Name`);
    if (!id && !categoryName) continue;
    if (!id || !categoryName) throw new Error(`Incomplete RsCatalog Level${level}`);
    const sourceKey = `rsv:catalog:L${level}:${id}`;
    categories.push({ sourceKey, name: categoryName, parentKey, slug: slug('category', categoryName) });
    parentKey = sourceKey;
  }
  const labelledItemChz = scalar(r.LabelledItemCHZ, 'LabelledItemCHZ');
  if (![null, 'Y', 'N', 'check'].includes(labelledItemChz)) throw new Error(`Unknown LabelledItemCHZ: ${labelledItemChz}`);
  const certificates = list(r.CertificateInfo).map(v => object(v, 'CertificateInfo'));
  const product = {
    supplierCode, name, slug: slug('product', name), itemId: int32(r.ItemID, 'ItemID'),
    countries: strings(list(r.Country).flatMap(v => object(v, 'Country').Value ?? []), 'Country.Value'),
    itemsPerUnit: decimal(r.ItemsPerUnit, 'ItemsPerUnit'),
    weight: decimal(weight.Value, 'Weight.Value'), weightUnit: scalar(weight.WeightUnit, 'WeightUnit'),
    depth: decimal(dimension.Depth, 'Depth'), width: decimal(dimension.Width, 'Width'),
    height: decimal(dimension.Height, 'Height'), dimensionUnit: scalar(dimension.DimensionUnit, 'DimensionUnit'),
    physicalRaw: { Weight: r.Weight ?? null, Dimension: r.Dimension ?? null, ItemsPerUnit: r.ItemsPerUnit ?? null },
    rsCatalog: r.RsCatalog || null, labelledItemChz,
    gost: strings([r.GOST, ...certificates.map(v => v.GOST)].flatMap(list), 'GOST'),
    ty: strings([r.TY, ...certificates.map(v => v.TY)].flatMap(list), 'TY'),
  };
  for (const [field, xml] of Object.entries({
    receiverCode: 'ReceiverPrdCode', description: 'ProductDescription', vendorNumber: 'VendorProdNum',
    guaranteePeriod: 'GuaranteePeriod', series: 'Series', uom: 'UOM', itemsPerUom: 'ItemsPerUOM',
    parentProdCode: 'ParentProdCode', parentProdGroup: 'ParentProdGroup', productCode: 'ProductCode',
    productGroup: 'ProductGroup', tnved: 'TNVED', okpd2: 'OKPD2', minprom: 'MINPROM', productGroupChz: 'ProductGroupCHZ',
  })) product[field] = scalar(r[xml], xml);
  return { product, brand: scalar(r.Brand, 'Brand'), categories, categoryKey: parentKey };
}
function documentMetadata(raw) {
  const result = { encoding: raw.encoding, xmlName: raw.xmlName };
  for (const key of ['DocType', 'SenderGln', 'ReceiverGln', 'Currency', 'DocumentNumber', 'DocumentDate']) result[key] = scalar(raw[key], key);
  if (result.DocType !== 'PRODAT') throw new Error('Document DocType must be PRODAT');
  result.documentDate = null;
  if (result.DocumentDate) {
    if (!/^\d{8}$/.test(result.DocumentDate)) throw new Error('Invalid DocumentDate');
    const s = result.DocumentDate;
    const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00.000Z`;
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== iso) throw new Error('Invalid DocumentDate');
    result.documentDate = iso;
  }
  return result;
}
module.exports = { scalar, strings, decimal, slug, normalizeProduct, documentMetadata };
