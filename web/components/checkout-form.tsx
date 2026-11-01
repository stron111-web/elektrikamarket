'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { beginPayment } from '../lib/cart-actions';

type Kind = 'pickup' | 'address' | 'pvz';

export function CheckoutForm({ name, phone, email, emailLocked, company }: {
  name: string; phone: string; email: string; emailLocked: boolean; company: string | null;
}) {
  const [kind, setKind] = useState<Kind>('pickup');
  const [notice, setNotice] = useState('');
  const [payUrl, setPayUrl] = useState('');
  const [pending, start] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? '');
    start(async () => {
      const result = await beginPayment({
        contactName: value('contactName'),
        phone: value('phone'),
        email: value('email'),
        deliveryKind: kind,
        carrier: value('carrier'),
        deliveryPoint: value('deliveryPoint'),
        comment: value('comment'),
      });
      if (!result.ok) {
        setNotice(result.message);
        setPayUrl('');
        return;
      }
      setNotice('');
      const url = `/pay/${result.token}`;
      const opened = window.open(url, 'em-pay', 'popup,width=460,height=720');
      setPayUrl(opened ? '' : url);
      if (!opened) setNotice('Браузер не открыл отдельное окно. Нажмите ссылку ниже: корзина останется на этой странице.');
    });
  }

  return (
    <form className="checkout-form" onSubmit={submit}>
      {company ? <p>Организация: {company}</p> : null}
      <label>Как к вам обращаться *
        <input name="contactName" defaultValue={name} required autoComplete="name" />
      </label>
      <label>Телефон *
        <input name="phone" defaultValue={phone} required autoComplete="tel" />
      </label>
      <label>Почта {emailLocked ? '' : <span className="required-note">необязательно, пригодится для регистрации</span>}
        <input name="email" type="email" defaultValue={email} readOnly={emailLocked} autoComplete="email" />
      </label>
      <fieldset>
        <legend>Как получить товар</legend>
        <label><input type="radio" name="kind" checked={kind === 'pickup'} onChange={() => setKind('pickup')} /> Самовывоз</label>
        <label><input type="radio" name="kind" checked={kind === 'address'} onChange={() => setKind('address')} /> Привезти на точный адрес</label>
        <label><input type="radio" name="kind" checked={kind === 'pvz'} onChange={() => setKind('pvz')} /> Пункт выдачи</label>
      </fieldset>
      {kind !== 'pickup' ? (
        <label>{kind === 'pvz' ? 'Компания пункта выдачи *' : 'Транспортная компания, если уже выбрали'}
          <input name="carrier" placeholder={kind === 'pvz' ? 'СДЭК' : 'СДЭК или другая'} />
        </label>
      ) : null}
      {kind === 'address' ? (
        <label>Точный адрес *
          <textarea name="deliveryPoint" required rows={3} />
        </label>
      ) : null}
      {kind === 'pvz' ? (
        <label>Адрес пункта выдачи *
          <textarea name="deliveryPoint" required rows={3} placeholder="Город, улица, номер пункта" />
        </label>
      ) : null}
      <label>Комментарий магазину
        <textarea name="comment" rows={3} />
      </label>
      <button type="submit" disabled={pending}>{pending ? 'Открываем оплату' : 'Оплатить'}</button>
      {notice ? <p className="account-notice">{notice}</p> : null}
      {payUrl ? <a href={payUrl} target="_blank">Открыть окно оплаты</a> : null}
      <p className="account-notice">Оплата открывается отдельно. Эта страница и корзина остаются. Если поправить корзину, пока окно открыто, оплату нужно начать заново. Номер карты вводится в окне банка, не на странице магазина.</p>
    </form>
  );
}
