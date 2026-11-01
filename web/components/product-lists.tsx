'use client';

import { useState, useTransition } from 'react';
import { toggleCompare, toggleFavorite } from '../lib/list-actions';

export function ProductLists({ productId, compared, favorite }: { productId: number; compared: boolean; favorite: boolean }) {
  const [compareOn, setCompareOn] = useState(compared);
  const [favoriteOn, setFavoriteOn] = useState(favorite);
  const [notice, setNotice] = useState('');
  const [pending, start] = useTransition();

  function run(kind: 'compare' | 'favorite') {
    start(async () => {
      const result = kind === 'compare' ? await toggleCompare(productId) : await toggleFavorite(productId);
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      setNotice('');
      if (kind === 'compare') setCompareOn(result.on);
      else setFavoriteOn(result.on);
    });
  }

  return (
    <div className="product-lists">
      <button type="button" className={compareOn ? 'quiet' : undefined} disabled={pending} onClick={() => run('compare')}>
        {compareOn ? 'В сравнении' : 'Добавить в сравнение'}
      </button>
      <button type="button" className={favoriteOn ? 'quiet' : undefined} disabled={pending} onClick={() => run('favorite')}>
        {favoriteOn ? 'В избранном' : 'В избранное'}
      </button>
      {notice ? <p className="account-notice">{notice}</p> : null}
    </div>
  );
}
