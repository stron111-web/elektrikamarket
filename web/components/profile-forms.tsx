'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { changePassword, updateProfile } from '../lib/account-actions';
import type { Buyer } from '../lib/session';

export function ProfileForms({ buyer }: { buyer: Buyer }) {
  const router = useRouter();
  const [notice, setNotice] = useState('');
  const [passwordNotice, setPasswordNotice] = useState('');

  return (
    <>
      <form
        className="account-form cabinet-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const result = await updateProfile({
            phone: String(data.get('phone') ?? ''),
            firstName: String(data.get('firstName') ?? ''),
            lastName: String(data.get('lastName') ?? ''),
            inn: String(data.get('inn') ?? ''),
            company: String(data.get('company') ?? ''),
            address: String(data.get('address') ?? ''),
            kpp: String(data.get('kpp') ?? ''),
            ogrn: String(data.get('ogrn') ?? ''),
            contact: String(data.get('contact') ?? ''),
          });
          setNotice(result.ok ? 'Сохранено.' : result.message);
          if (result.ok) router.refresh();
        }}
      >
        <h2>Данные</h2>
        {buyer.kind === 'individual' ? (
          <>
            <label>Имя *<input name="firstName" defaultValue={buyer.firstName ?? ''} required /></label>
            <label>Фамилия<input name="lastName" defaultValue={buyer.lastName ?? ''} /></label>
          </>
        ) : (
          <>
            <label>ИНН *<input name="inn" inputMode="numeric" maxLength={12} defaultValue={buyer.inn ?? ''} required /></label>
            <label>Название *<input name="company" defaultValue={buyer.company ?? ''} required /></label>
            <label>Юридический адрес *<input name="address" defaultValue={buyer.legalAddress ?? ''} required /></label>
            <label>КПП *<input name="kpp" defaultValue={buyer.kpp ?? ''} required /></label>
            <label>ОГРН *<input name="ogrn" defaultValue={buyer.ogrn ?? ''} required /></label>
            <label>Контактное лицо *<input name="contact" defaultValue={buyer.contactName ?? ''} required /></label>
          </>
        )}
        <label>Телефон *<input name="phone" defaultValue={buyer.phone} required /></label>
        <p className="muted">Почта для входа: {buyer.email}</p>
        <button type="submit">Сохранить</button>
        {notice ? <p className="account-notice">{notice}</p> : null}
      </form>
      <form
        className="account-form cabinet-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const result = await changePassword(String(data.get('current') ?? ''), String(data.get('next') ?? ''), String(data.get('repeat') ?? ''));
          setPasswordNotice(result.ok ? 'Пароль изменён.' : result.message);
          if (result.ok) event.currentTarget.reset();
        }}
      >
        <h2>Сменить пароль</h2>
        <label>Старый пароль<input name="current" type="password" autoComplete="current-password" required /></label>
        <label>Новый пароль<input name="next" type="password" autoComplete="new-password" required /></label>
        <label>Новый пароль ещё раз<input name="repeat" type="password" autoComplete="new-password" required /></label>
        <button type="submit">Сменить пароль</button>
        {passwordNotice ? <p className="account-notice">{passwordNotice}</p> : null}
      </form>
    </>
  );
}
