import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AdminShell } from '../../components/admin-shell';
import { currentStaff } from '../../lib/staff';

export const metadata: Metadata = { title: { absolute: 'Electric Market' }, robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const staff = await currentStaff();
  if (!staff) return children;
  return <AdminShell email={staff.email} siteGate={process.env.PREVIEW_STAFF_BASIC_AUTH === '1'}>{children}</AdminShell>;
}
