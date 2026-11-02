'use strict';
function text(value, field) {
  if (value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`Ambiguous ${field}`);
  return value.trim();
}
function decimal(value, field, precision = 20, scale = 10) {
  const s = text(value, field);
  if (s === null || s === '') return null;
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid nonnegative decimal ${field}: ${s}`);
  const [whole, fraction = ''] = s.split('.');
  if (whole.replace(/^0+/, '').length > precision - scale || fraction.replace(/0+$/, '').length > scale)
    throw new Error(`Decimal overflow/precision loss ${field}: ${s}`);
  return s;
}
function scaled(s, scale) {
  const [a, b = ''] = s.split('.');
  return BigInt(a) * 10n ** BigInt(scale) + BigInt(b.padEnd(scale, '0').slice(0, scale) || '0');
}
// Only suppress decimal tails consistent with binary64 calculation noise.
// Bound: <= 8 * Number.EPSILON relative AND <= 1e-12 absolute (10,000x
// smaller than the stored quantity quantum 1e-8). All decisions use BigInt.
function quantity(value, field) {
  try { return { value: decimal(value, field, 20, 8), normalized: false }; }
  catch (original) {
    const raw = text(value, field);
    if (!raw || raw.length > 128 || !/^\d+\.\d{13,30}$/.test(raw)) throw original;
    const [whole, fraction] = raw.split('.');
    const denominator = 10n ** BigInt(fraction.length);
    const numerator = BigInt(whole) * denominator + BigInt(fraction);
    const rounded = (numerator * 100000000n + denominator / 2n) / denominator;
    const delta = numerator * 100000000n - rounded * denominator;
    const distance = delta < 0n ? -delta : delta;
    if (distance * (2n ** 49n) > numerator * 100000000n
      || distance * 1000000000000n > denominator * 100000000n) throw original;
    const output = (String(rounded / 100000000n) + '.' + String(rounded % 100000000n).padStart(8, '0')).replace(/\.?0+$/, '');
    return { value: decimal(output, field, 20, 8), normalized: true };
  }
}
function money(cents) { return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`; }
function customerPrice(retail, cost, markup) {
  if (retail === null || cost === null) return retail;
  const r = scaled(retail, 2), c = scaled(cost, 2);
  if (r >= c) return retail;
  const percent = scaled(decimal(String(markup), 'protectiveMarkupPercent', 7, 3), 3);
  const result = money((c * (100000n + percent) + 50000n) / 100000n);
  decimal(result, 'effectiveRetailPrice', 14, 2);
  return result;
}
function date(value, field) {
  const s = text(value, field);
  if (!s) return null;
  if (!/^\d{8}$/.test(s)) throw new Error(`Invalid date ${field}`);
  const iso = `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  const d = new Date(iso);
  if (!Number.isFinite(+d) || d.toISOString().slice(0,10) !== iso) throw new Error(`Invalid date ${field}`);
  return iso;
}
function normalizePricat(record, source, markup, currency) {
  if (!['PRICAT1', 'PRICAT2'].includes(source)) throw new Error('Explicit PRICAT source required');
  const t = key => text(record[key], key);
  const d = (key, p = 20, s = 10) => decimal(record[key], key, p, s);
  const supplierCode = t('SenderPrdCode');
  if (!supplierCode) throw new Error('Missing SenderPrdCode');
  const uom = t('UOM');
  const commercial = { source, multiplicity: d('Multiplicity'), multiplicityRaw: record.Multiplicity ?? null,
    itemsPerUnit: d('ItemsPerUnit'), itemsPerUom: t('ItemsPerUOM'), uom, analitCat: t('AnalitCat'), mark: t('Mark'), rawData: record };
  for (const field of ['BlockExpAll','BlockExpBy','BlockExpKz']) {
    const v = t(field);
    if (v && !['Y','N'].includes(v)) throw new Error(`Invalid flag ${field}`);
    commercial[field[0].toLowerCase()+field.slice(1)] = v ? v === 'Y' : null;
  }
  const price = { retailPrice: d('RetailPrice',14,2), custPrice: d('CustPrice',14,2), price2: d('Price2',14,2),
    mrc: d('MRC',14,2), bsp: d('BSP',14,2), availabilityMrc: t('Availability_MRC'),
    currency: currency?.toUpperCase() || null, retailCurrency: t('RetailCurrency')?.toUpperCase() || null };
  if (price.retailPrice !== null && price.price2 !== null && price.currency !== price.retailCurrency)
    throw new Error('Price currencies differ or are missing');
  const effectiveRetailPrice = customerPrice(price.retailPrice, price.price2, markup);
  const anomalous = effectiveRetailPrice !== price.retailPrice;
  // rawData retains supplier prices; retailPrice contains the safe buyer price.
  price.rawData = { ...record, effectiveRetailPrice, protectiveMarkupPercent: String(markup), protectiveRuleApplied: anomalous };
  price.retailPrice = effectiveRetailPrice;
  const stocks = [];
  const primaryQuantity = quantity(record.QTY, 'QTY'), qty = primaryQuantity.value;
  if (qty !== null) {
    if (!uom) throw new Error('QTY without UOM');
    stocks.push({ warehouse: source === 'PRICAT1' ? 'stock1' : 'stock2', quantity: qty, quantityRaw: record.QTY,
      uom, source, quantityField: 'QTY', sourceUpdatedDate: null, estimatedArrivalDate: null, quantityNormalized: primaryQuantity.normalized });
  }
  if (source === 'PRICAT1' && record.SupOnhandDetail !== undefined) {
    const partner = record.SupOnhandDetail;
    if (!partner || typeof partner !== 'object' || Array.isArray(partner)) throw new Error('Ambiguous SupOnhandDetail');
    const partnerQuantity = quantity(partner.PartnerQTY,'PartnerQTY');
    if (partnerQuantity.value !== null) {
      const partnerUom = text(partner.PartnerUOM,'PartnerUOM');
      if (!partnerUom) throw new Error('PartnerQTY without PartnerUOM');
      stocks.push({ warehouse:'stock3',quantity:partnerQuantity.value,quantityRaw:partner.PartnerQTY,uom:partnerUom,source,quantityField:'PARTNER_QTY',quantityNormalized:partnerQuantity.normalized,
        sourceUpdatedDate:date(partner.LastUpdDate,'LastUpdDate'),estimatedArrivalDate:date(partner.EstimatedArrivalDate,'EstimatedArrivalDate') });
    }
  }
  return { supplierCode, commercial, price, stocks, anomalous };
}
module.exports = { normalizePricat, customerPrice, decimal, quantity };
