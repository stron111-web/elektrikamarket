'use client';

import { useRef, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { beginPayment, saveUnpaid } from '../lib/cart-actions';
import { PvzPicker } from './pvz-picker';

type Kind = 'pickup' | 'address' | 'pvz';

export function CheckoutForm({ name, phone, email, known, company, goods, mapKey, initialCity, savedPoint, allowUnpaid }: {
  name: string; phone: string; email: string; known: boolean; company: string | null; goods: string; mapKey: string;
  initialCity: string; savedPoint: string; allowUnpaid?: boolean;
}) {
  const [kind, setKind] = useState<Kind>('pvz');
  const [notice, setNotice] = useState('');
  const [payUrl, setPayUrl] = useState('');
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  function fields(form: HTMLFormElement) {
    const data = new FormData(form);
    const value = (key: string) => String(data.get(key) ?? '');
    return {
      contactName: value('contactName'),
      phone: value('phone'),
      email: value('email'),
      deliveryKind: kind,
      carrier: value('carrier'),
      deliveryPoint: value('deliveryPoint'),
      cdekCityCode: value('cdekCity'),
      cdekPointCode: value('cdekPoint'),
      comment: value('comment'),
    };
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    start(async () => {
      const result = await beginPayment(fields(form));
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

  function keepUnpaid() {
    const form = formRef.current;
    if (!form) return;
    start(async () => {
      const result = await saveUnpaid(fields(form));
      setPayUrl('');
      setNotice(result.ok
        ? `Заказ ${result.orderId.padStart(4, '0')} сохранён со статусом «Не оплачен». Оплата не проводилась, корзина очищена. В админке откройте этот заказ и нажмите «Передать в СДЭК».`
        : result.message);
      if (result.ok) router.refresh();
    });
  }

  return (
    <form className="checkout-form" ref={formRef} onSubmit={submit}>
      {company ? <p>Организация: {company}</p> : null}
      {known ? (
        <>
          <p>Оформим на {name}. Телефон и почта уже есть в кабинете.</p>
          <input type="hidden" name="contactName" value={name} />
          <input type="hidden" name="phone" value={phone} />
          <input type="hidden" name="email" value={email} />
        </>
      ) : (
        <>
          <label>Как к вам обращаться *
            <input name="contactName" defaultValue={name} required autoComplete="name" />
          </label>
          <label>Телефон *
            <input name="phone" defaultValue={phone} required autoComplete="tel" />
          </label>
          <label>Почта <span className="required-note">необязательно, пригодится для регистрации</span>
            <input name="email" type="email" defaultValue={email} autoComplete="email" />
          </label>
        </>
      )}
      <fieldset>
        <legend>Как получить товар</legend>
        <label><input type="radio" name="kind" checked={kind === 'pickup'} onChange={() => setKind('pickup')} /> Самовывоз</label>
        <label><input type="radio" name="kind" checked={kind === 'address'} onChange={() => setKind('address')} /> Привезти на точный адрес</label>
        <label><input type="radio" name="kind" checked={kind === 'pvz'} onChange={() => setKind('pvz')} /> Пункт выдачи</label>
      </fieldset>
      {kind === 'address' ? (
        <label>Транспортная компания, если уже выбрали
          <input name="carrier" placeholder="СДЭК или другая" />
        </label>
      ) : null}
      {kind === 'address' ? (
        <label>Точный адрес *
          <textarea name="deliveryPoint" required rows={3} />
        </label>
      ) : null}
      {kind === 'pvz' ? <PvzPicker mapKey={mapKey} goods={goods} initialCity={initialCity} savedPoint={savedPoint} signedIn={known} /> : null}
      <label>Комментарий магазину
        <textarea name="comment" rows={3} />
      </label>
      <button type="submit" disabled={pending}>{pending ? 'Открываем оплату' : 'Оплатить'}</button>
      {allowUnpaid ? <button type="button" disabled={pending} onClick={keepUnpaid}>Оформить без оплаты</button> : null}
      {allowUnpaid ? <p className="account-notice">«Оформить без оплаты» только сохраняет заказ со статусом «Не оплачен» и убирает товары из корзины. Деньги не списываются. В СДЭК заказ уходит из админки.</p> : null}
      {notice ? <p className="account-notice">{notice}</p> : null}
      {payUrl ? <a href={payUrl} target="_blank">Открыть окно оплаты</a> : null}
      <p className="account-notice">Кнопка «Оплатить» открывает отдельное окно. Пока оплата не прошла, корзина остаётся. Если поправить корзину, пока окно открыто, оплату нужно начать заново. Номер карты вводится в окне банка, не на странице магазина.</p>
    </form>
  );
}
