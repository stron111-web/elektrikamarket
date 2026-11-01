import 'server-only';
import { cookies } from 'next/headers';
import { productCode } from './data';
import { shop } from './shop';

const compareCookie = 'em_compare';
const favoriteCookie = 'em_favorites';
export const compareLimit = 4;

function parseIds(raw: string | undefined, limit: number) {
  if (!raw) return [];
  const ids: number[] = [];
  for (const part of raw.split(',')) {
    if (!/^\d{1,9}$/.test(part)) continue;
    const id = Number(part);
    if (id > 0 && !ids.includes(id)) ids.push(id);
    if (ids.length >= limit) break;
  }
  return ids;
}

async function readCookie(name: string, limit: number) {
  return parseIds((await cookies()).get(name)?.value, limit);
}

async function writeCookie(name: string, ids: number[]) {
  const jar = await cookies();
  if (!ids.length) {
    jar.delete(name);
    return;
  }
  jar.set(name, ids.join(','), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 180, secure: process.env.NODE_ENV === 'production' });
}

export async function guestCompareIds() {
  return readCookie(compareCookie, compareLimit);
}

export async function guestFavoriteIds() {
  return readCookie(favoriteCookie, 100);
}

export async function compareIds(buyerId?: string) {
  if (!buyerId) return guestCompareIds();
  const rows = await shop()<{ product_id: number }[]>`SELECT product_id FROM comparisons WHERE buyer_id = ${buyerId} ORDER BY created_at, product_id`;
  return rows.map((row) => row.product_id);
}

export async function favoriteIds(buyerId?: string) {
  if (!buyerId) return guestFavoriteIds();
  const rows = await shop()<{ product_id: number }[]>`SELECT product_id FROM favorites WHERE buyer_id = ${buyerId} ORDER BY created_at DESC, product_id`;
  return rows.map((row) => row.product_id);
}

async function supplierCode(productId: number) {
  return productCode(productId);
}

export async function rememberGuestLists(buyerId: string) {
  const compared = await guestCompareIds();
  const favorites = await guestFavoriteIds();
  for (const productId of compared) {
    const code = await supplierCode(productId);
    if (!code) continue;
    await shop()`INSERT INTO comparisons (buyer_id, product_id, supplier_code) VALUES (${buyerId}, ${productId}, ${code}) ON CONFLICT DO NOTHING`;
  }
  for (const productId of favorites) {
    const code = await supplierCode(productId);
    if (!code) continue;
    await shop()`INSERT INTO favorites (buyer_id, product_id, supplier_code) VALUES (${buyerId}, ${productId}, ${code}) ON CONFLICT DO NOTHING`;
  }
  await writeCookie(compareCookie, []);
  await writeCookie(favoriteCookie, []);
}

export async function setGuestCompare(ids: number[]) {
  await writeCookie(compareCookie, ids.slice(0, compareLimit));
}

export async function setGuestFavorites(ids: number[]) {
  await writeCookie(favoriteCookie, ids.slice(0, 100));
}

export async function codeForProduct(productId: number) {
  return supplierCode(productId);
}
