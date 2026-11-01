'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { changeCart, clearCart } from '../lib/cart-actions';

export function CartQty({ productId, quantity }: { productId: number; quantity: string }) {
  const [notice, setNotice] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();

  function run(action: 'inc' | 'dec' | 'remove' | 'set', raw?: string) {
    start(async () => {
      const result = await changeCart(productId, action, raw);
      setNotice(result.message);
      router.refresh();
    });
  }

  return (
    <div className="cart-qty-block">
      <div className="qty">
        <button type="button" aria-label="Меньше" disabled={pending} onClick={() => run('dec')}>−</button>
        <input aria-label="Количество" defaultValue={quantity} key={quantity} onBlur={(event) => {
          if (event.target.value !== quantity) run('set', event.target.value);
        }} />
        <button type="button" aria-label="Больше" disabled={pending} onClick={() => run('inc')}>+</button>
        <button type="button" className="text-button" disabled={pending} onClick={() => run('remove')}>Убрать</button>
      </div>
      {notice ? <p className="cart-line-note">{notice}</p> : null}
    </div>
  );
}

export function ClearCart() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button type="button" className="secondary" disabled={pending} onClick={() => start(async () => {
      await clearCart();
      router.refresh();
    })}>
      Очистить корзину
    </button>
  );
}
