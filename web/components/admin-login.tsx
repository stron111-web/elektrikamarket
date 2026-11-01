'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { loginStaff } from '../lib/admin-actions';

export function AdminLogin() {
  const [message, setMessage] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <form
      className="admin-login"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        start(async () => {
          const result = await loginStaff(String(data.get('email') ?? ''), String(data.get('password') ?? ''));
          if (!result.ok) setMessage(result.message);
          else {
            setMessage('');
            router.refresh();
          }
        });
      }}
    >
      <h1>Electric Market</h1>
      <p>Вход для магазина. Покупательский «Войти» сюда не подходит.</p>
      <label>Почта<input name="email" type="email" autoComplete="username" required /></label>
      <label>Пароль<input name="password" type="password" autoComplete="current-password" required /></label>
      <button type="submit" disabled={pending}>Войти</button>
      {message ? <p className="account-notice">{message}</p> : null}
    </form>
  );
}
