'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { sendToCdek } from '../lib/admin-actions';

export function SendToCdek({ id, label }: { id: string; label: string }) {
  const [message, setMessage] = useState('');
  const [pending, start] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    start(async () => {
      const result = await sendToCdek(data);
      setMessage(result?.message ?? 'СДЭК не ответил. Откройте заказ ещё раз и проверьте статус.');
    });
  }

  return (
    <form className="admin-inline" onSubmit={submit}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending}>{pending ? 'Передаём в СДЭК' : label}</button>
      {message ? <p className="account-notice">{message}</p> : null}
    </form>
  );
}
