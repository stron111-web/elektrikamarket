import type { Metadata } from 'next';
import { AccountForm } from '../../components/account-gate';

export const metadata: Metadata = { title: 'Регистрация' };

export default function RegisterPage() {
  return (
    <div className="plain-page login-page">
      <AccountForm />
    </div>
  );
}
