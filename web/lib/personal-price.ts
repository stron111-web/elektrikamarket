import 'server-only';
import { markupPrices } from './data';
import { discounted } from './price';
import type { Buyer } from './session';

/** Цена, которую платит этот покупатель. Для обычного клиента карта пустая: берётся розница. Закупка сюда не попадает. */
export async function personalPriceMap(buyer: Buyer | null, rows: { id: number; retail: string | null }[]) {
  const prices = new Map<number, string | null>();
  if (!buyer || buyer.status === 'regular') return prices;
  if (buyer.status === 'discount') {
    for (const row of rows) {
      if (row.retail) prices.set(row.id, discounted(row.retail, buyer.discountPercent));
    }
    return prices;
  }
  const marked = await markupPrices(rows.flatMap((row) => row.retail ? [row.id] : []), buyer.markupPercent);
  for (const row of rows) prices.set(row.id, marked.get(row.id) ?? null);
  return prices;
}
