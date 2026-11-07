import { redirect } from 'next/navigation';
import { AdminKeys } from '../../../components/admin-keys';
import { currentStaff } from '../../../lib/staff';

export const dynamic = 'force-dynamic';

export default async function AdminKeyPage() {
  if (!(await currentStaff())) redirect('/admin');
  return <AdminKeys />;
}
