'use client';

import { useEffect, useState, useTransition } from 'react';
import { cancelPayment, confirmPayment } from '../lib/cart-actions';

export function PayDesk({ token, amount }: { token: string; amount: string }) {
  const [text, setText] = useState('');
  const [done, setDone] = useState('');
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => window.close(), 1400);
    return () => window.clearTimeout(timer);
  }, [done]);

  function finish(kind: 'pay' | 'cancel') {
    start(async () => {
      const result = kind === 'pay' ? await confirmPayment(token) : await cancelPayment(token);
      if (!result.ok) {
        setText(result.message);
        return;
      }
      setDone(result.orderId);
      setText('Деньги списаны. Заказ сохранён. Это окно закроется, корзина на сайте перейдёт в заказ.');
      const payload = { type: 'em-paid', orderId: result.orderId };
      const channel = new BroadcastChannel('em-pay');
      channel.postMessage(payload);
      channel.close();
      if (window.opener && !window.opener.closed) window.opener.postMessage(payload, window.location.origin);
      else window.location.assign(`/order/done?order=${result.orderId}`);
    });
  }

  return (
    <section className="pay-desk">
      <h1>Оплата</h1>
      <p>К оплате {amount}. Учебное окно банка: номер карты магазин не спрашивает и не хранит. Здесь потом будет настоящий шлюз.</p>
      {text ? <p className="account-notice">{text}</p> : null}
      {done ? <a href={`/order/done?order=${done}`}>Открыть заказ</a> : (
        <div className="cart-actions">
          <button type="button" disabled={pending} onClick={() => finish('pay')}>Деньги списались</button>
          <button type="button" className="secondary" disabled={pending} onClick={() => finish('cancel')}>Вернуться без оплаты</button>
        </div>
      )}
    </section>
  );
}
