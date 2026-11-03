'use server';

import { revalidatePath } from 'next/cache';
import { addProduct, changeProduct, emptyCart, openPayment, settlePayment } from './cart';
import { currentBuyer } from './session';

function refresh() {
  revalidatePath('/', 'layout');
  revalidatePath('/cart');
  revalidatePath('/cart/checkout');
}

function refreshOrder() {
  revalidatePath('/cart');
  revalidatePath('/cart/checkout');
  revalidatePath('/account/orders');
}

const kept = 'Количество подровняли по кратности и остатку.';

export async function addToCart(productId: number) {
  const message = await addProduct(await currentBuyer(), productId);
  refresh();
  if (!message || message === kept) return { ok: true as const, message };
  return { ok: false as const, message };
}

export async function changeCart(productId: number, action: 'inc' | 'dec' | 'remove' | 'set', raw?: string) {
  const message = await changeProduct(await currentBuyer(), productId, action, raw);
  refresh();
  if (!message || message === kept) return { ok: true as const, message };
  return { ok: false as const, message };
}

export async function clearCart() {
  const buyer = await currentBuyer();
  await emptyCart(buyer?.id);
  refresh();
}

export async function beginPayment(input: {
  contactName: string; phone: string; email: string; deliveryKind: string; carrier: string; deliveryPoint: string; comment: string;
  cdekCityCode?: string; cdekPointCode?: string;
}) {
  const result = await openPayment(await currentBuyer(), input);
  if (result.ok) refresh();
  return result;
}

export async function confirmPayment(token: string) {
  const result = await settlePayment(token, await currentBuyer(), 'pay');
  if (result.ok) refreshOrder();
  return result;
}

export async function cancelPayment(token: string) {
  const result = await settlePayment(token, await currentBuyer(), 'cancel');
  refreshOrder();
  return result;
}
