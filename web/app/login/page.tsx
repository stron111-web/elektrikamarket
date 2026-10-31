import type { Metadata } from 'next';
import { AccountForm } from '../../components/account-gate';

export const metadata: Metadata = { title: 'Войти' };

export default function LoginPage() {
  return (
    <div className="plain-page login-page">
      <AccountForm />
    </div>
  );
}
