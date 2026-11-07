import Link from 'next/link';
import type { ReactNode } from 'react';
import { logoutStaff } from '../lib/admin-actions';

export function AdminShell({ email, siteGate, children }: { email: string; siteGate?: boolean; children: ReactNode }) {
  return (
    <section className="admin-page">
      <div className="admin-nav">
        <b>Админка</b>
        <Link href="/admin/orders">Заказы</Link>
        <Link href="/admin/clients">Клиенты</Link>
        <Link href="/admin/pages">Страницы</Link>
        <Link className="admin-keys-link" href="/admin/keys">Ключи и доступы</Link>
        {siteGate ? <span>Имя в шапке — это покупатель, не вход сюда.</span> : (
          <form action={logoutStaff}>
            <button className="text-button" type="submit">Выйти</button>
          </form>
        )}
        <span className="admin-who">{email}</span>
      </div>
      {children}
    </section>
  );
}
