'use server';

import { cityByCode, findAllPoints, findCities, findPoints, findVisiblePoints, quotePvz, type CdekBounds } from './cdek';
import { loadCart } from './cart';
import { packagesFor } from './parcel';
import { sumMoney } from './price';
import { currentBuyer } from './session';
import { storeDelivery } from './saved-delivery';

export async function rememberDelivery(input: { city: string; cityCode: number; pointCode?: string; pointAddress?: string }) {
  const buyer = await currentBuyer();
  if (!buyer) return;
  const city = input.city.trim().slice(0, 80);
  if (!city || !Number.isInteger(input.cityCode) || input.cityCode <= 0) return;
  try {
    await storeDelivery(buyer.id, {
      city,
      cityCode: input.cityCode,
      pointCode: input.pointCode?.trim().slice(0, 32) || null,
      pointAddress: input.pointAddress?.trim().slice(0, 300) || null,
    });
  } catch {
    return;
  }
}

export async function searchCities(query: string) {
  return findCities(query);
}

export async function loadCity(cityCode: number) {
  return cityByCode(cityCode);
}

export async function loadPoints(cityCode: number) {
  return findPoints(cityCode);
}

export async function loadAllPoints() {
  return findAllPoints();
}

export async function loadVisiblePoints(bounds: CdekBounds) {
  return findVisiblePoints(bounds);
}

export async function pricePoint(cityCode: number, pointCode: string) {
  const cart = await loadCart(await currentBuyer(), false);
  const payable = cart.lines.filter((line) => line.available && line.unitPrice && line.lineTotal);
  if (!payable.length) return { ok: false as const, message: 'В корзине нет товаров, которые можно оплатить.' };
  const packed = await packagesFor(payable.map((line) => ({ productId: line.productId, quantity: line.quantity, name: line.name })));
  if (!packed.ok) return packed;
  const quote = await quotePvz(cityCode, pointCode, packed.packages);
  if (!quote.ok) return quote;
  if (quote.study) return { ok: false as const, message: 'Сумму доставки по договору СДЭК пока не посчитать: ключ кабинета со снимка не подошёл. Новый ключ создавать не нужно.' };
  return { ok: true as const, amount: quote.amount, period: quote.period, tariffName: quote.tariffName, total: sumMoney([cart.total, quote.amount]), address: quote.address };
}
