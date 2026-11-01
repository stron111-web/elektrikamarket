import { AdminLogin } from '../../components/admin-login';
import { currentStaff } from '../../lib/staff';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  const staff = await currentStaff();
  if (!staff) return <AdminLogin />;
  return (
    <>
      <h1>Electric Market</h1>
      <p>Здесь заказы, клиенты и тексты страниц. Внешний вид сайта и каталог поставщика отсюда не меняются.</p>
    </>
  );
}
