import 'server-only';
import { productsForLists } from './data';
import { parseQty } from './quantity';
import type { CdekPackage } from './cdek';

const SCALE = 10n ** 10n;
const MILLI = 10n ** 6n;

function scaled(value: unknown) {
  const text = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  return BigInt(whole) * MILLI + BigInt((frac + '000000').slice(0, 6));
}

function grams(weight: unknown, unit: unknown, quantity: bigint) {
  const value = scaled(weight);
  const name = String(unit ?? '').trim().toUpperCase();
  const factor = ({ KGM: 1000n, KG: 1000n, 'КГ': 1000n, GRM: 1n, G: 1n, 'Г': 1n, 'ГР': 1n, TNE: 1000000n, T: 1000000n, 'Т': 1000000n } as Record<string, bigint>)[name];
  if (!value || !factor) return null;
  const total = (value * factor * quantity + SCALE * MILLI / 2n) / (SCALE * MILLI);
  return total > 0n ? total : null;
}

function centimeters(value: unknown, unit: unknown) {
  const size = scaled(value);
  const name = String(unit ?? '').trim().toUpperCase();
  const factor = ({ MMT: 1n, MM: 1n, 'ММ': 1n, CMT: 10n, CM: 10n, 'СМ': 10n, MTR: 1000n, M: 1000n, 'М': 1000n } as Record<string, bigint>)[name];
  if (!size || !factor) return null;
  const mm = (size * factor + MILLI / 2n) / MILLI;
  if (mm <= 0n) return null;
  const cm = (mm + 5n) / 10n;
  return Number(cm > 0n ? cm : 1n);
}

function onePlace(item: { weight?: unknown; weightUnit?: unknown; depth?: unknown; width?: unknown; height?: unknown; dimensionUnit?: unknown }, quantity: bigint): CdekPackage | null {
  const weight = grams(item.weight, item.weightUnit, quantity);
  const length = centimeters(item.depth, item.dimensionUnit);
  const width = centimeters(item.width, item.dimensionUnit);
  const height = centimeters(item.height, item.dimensionUnit);
  if (!weight || !length || !width || !height || weight > 2_000_000_000) return null;
  return { weight: Number(weight), length, width, height };
}

/** Места для калькулятора СДЭК. Пустой вес или размер не подменяем. */
export async function packagesFor(lines: { productId: number; quantity: string; name: string }[]) {
  const listed = await productsForLists(lines.map((line) => line.productId));
  const byId = new Map(listed.map((row) => [row.item.id, row.item]));
  const missing: string[] = [];
  const packages: CdekPackage[] = [];
  for (const line of lines) {
    const quantity = parseQty(line.quantity);
    const item = byId.get(line.productId);
    const place = item && quantity ? onePlace({
      weight: item.weight, weightUnit: item.weightUnit, depth: item.depth, width: item.width, height: item.height, dimensionUnit: item.dimensionUnit,
    }, quantity) : null;
    if (!place) missing.push(line.name);
    else packages.push(place);
  }
  if (missing.length) return { ok: false as const, message: `СДЭК не считает доставку: нет веса или размеров у «${missing[0]}».` };
  return { ok: true as const, packages };
}
