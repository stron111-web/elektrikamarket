import Link from 'next/link';
import type { ReactNode } from 'react';
import { logoutStaff } from '../lib/admin-actions';

export function AdminShell({ email, children }: { email: string; children: ReactNode }) {
  return (
    <section className="admin-page">
      <div className="admin-nav">
        <b>Electric Market</b>
        <Link href="/admin/orders">Заказы</Link>
        <Link href="/admin/clients">Клиенты</Link>
        <Link href="/admin/pages">Страницы</Link>
        <form action={logoutStaff}>
          <button className="text-button" type="submit">Выйти</button>
        </form>
        <span className="admin-who">{email}</span>
      </div>
      {children}
    </section>
  );
}
