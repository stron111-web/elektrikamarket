'use server';

import { revalidatePath } from 'next/cache';
import { codeForProduct, compareIds, compareLimit, favoriteIds, setGuestCompare, setGuestFavorites } from './lists';
import { shop } from './shop';
import { currentBuyer } from './session';

export type ListResult = { ok: true; on: boolean } | { ok: false; message: string };

function refresh() {
  revalidatePath('/', 'layout');
  revalidatePath('/compare');
  revalidatePath('/favorites');
}

export async function toggleCompare(productId: number): Promise<ListResult> {
  if (!Number.isInteger(productId) || productId <= 0) return { ok: false, message: 'Товар не найден.' };
  const code = await codeForProduct(productId);
  if (!code) return { ok: false, message: 'Этого товара нет в каталоге.' };
  const buyer = await currentBuyer();
  const ids = await compareIds(buyer?.id);
  const has = ids.includes(productId);
  if (!has && ids.length >= compareLimit) return { ok: false, message: 'В сравнении уже четыре товара. Уберите один, чтобы добавить новый.' };
  if (buyer) {
    if (has) await shop()`DELETE FROM comparisons WHERE buyer_id = ${buyer.id} AND product_id = ${productId}`;
    else await shop()`INSERT INTO comparisons (buyer_id, product_id, supplier_code) VALUES (${buyer.id}, ${productId}, ${code}) ON CONFLICT DO NOTHING`;
  } else {
    const next = has ? ids.filter((id) => id !== productId) : [...ids, productId];
    await setGuestCompare(next);
  }
  refresh();
  return { ok: true, on: !has };
}

export async function toggleFavorite(productId: number): Promise<ListResult> {
  if (!Number.isInteger(productId) || productId <= 0) return { ok: false, message: 'Товар не найден.' };
  const code = await codeForProduct(productId);
  if (!code) return { ok: false, message: 'Этого товара нет в каталоге.' };
  const buyer = await currentBuyer();
  const ids = await favoriteIds(buyer?.id);
  const has = ids.includes(productId);
  if (buyer) {
    if (has) await shop()`DELETE FROM favorites WHERE buyer_id = ${buyer.id} AND product_id = ${productId}`;
    else await shop()`INSERT INTO favorites (buyer_id, product_id, supplier_code) VALUES (${buyer.id}, ${productId}, ${code}) ON CONFLICT DO NOTHING`;
  } else {
    const next = has ? ids.filter((id) => id !== productId) : [productId, ...ids].slice(0, 100);
    await setGuestFavorites(next);
  }
  refresh();
  return { ok: true, on: !has };
}
