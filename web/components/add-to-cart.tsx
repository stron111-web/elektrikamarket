'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { changeCart } from '../lib/cart-actions';
import { unit } from '../lib/format';
import { formatQty, parseQty, saleStep } from '../lib/quantity';

export function AddToCart({
  productId, canBuy, multiplicity, multiplicityRaw, uom,
}: {
  productId: number;
  canBuy: boolean;
  multiplicity: string | null;
  multiplicityRaw: string | null;
  uom: string;
}) {
  const [draft, setDraft] = useState('0');
  const [notice, setNotice] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();
  const sale = saleStep(multiplicity, multiplicityRaw);
  const stepLabel = formatQty(sale.step);
  const hint = sale.known && stepLabel !== '1' ? `Кратно ${stepLabel} ${unit(uom)}` : '';
  const chosen = parseQty(draft);

  function shift(direction: 1 | -1) {
    const current = chosen ?? 0n;
    const next = current + BigInt(direction) * sale.step;
    setDraft(next > 0n ? formatQty(next) : '0');
    setNotice('');
  }

  function put() {
    if (!chosen || !canBuy) return;
    const raw = draft.trim().replace(',', '.');
    start(async () => {
      const result = await changeCart(productId, 'set', raw);
      setNotice(result.message);
      if (result.ok) setDraft('0');
      router.refresh();
    });
  }

  return (
    <div className="line-cart">
      <div className="pick-row">
        <button type="button" aria-label="Меньше" disabled={pending || !chosen} onClick={() => shift(-1)}>−</button>
        <input
          aria-label="Количество"
          inputMode="decimal"
          value={draft}
          disabled={pending}
          onChange={(event) => {
            setDraft(event.target.value.replace(/[^\d.,]/g, '').slice(0, 12));
            setNotice('');
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            put();
          }}
        />
        <button type="button" aria-label="Больше" disabled={pending || !canBuy} onClick={() => shift(1)}>+</button>
        <button type="button" className="cart-put" aria-label="Положить выбранное количество в корзину" disabled={pending || !canBuy || !chosen} onClick={put}>
          <CartMark />
        </button>
      </div>
      {hint ? <small className="step-hint">{hint}</small> : null}
      {notice ? <small className="step-hint">{notice}</small> : null}
    </div>
  );
}

function CartMark() {
  return (
    <svg className="cart-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 7h15l-1.6 9H7.2z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M6 7L4.5 3H2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="9" cy="20" r="1.4" fill="currentColor" />
      <circle cx="17" cy="20" r="1.4" fill="currentColor" />
    </svg>
  );
}
