import Link from 'next/link';
import { redirect } from 'next/navigation';
import { pageSlugs } from '../../../lib/pages';
import { currentStaff } from '../../../lib/staff';

export const dynamic = 'force-dynamic';

export default async function AdminPages() {
  if (!(await currentStaff())) redirect('/admin');
  return (
    <>
      <h1>Страницы</h1>
      <p>Текст, который меняется в работе магазина. Цвета, кнопки и каталог здесь не правятся.</p>
      <ul className="admin-pages">
        {Object.entries(pageSlugs).map(([slug, title]) => (
          <li key={slug}><Link href={`/admin/pages/${slug}`}>{title}</Link></li>
        ))}
      </ul>
    </>
  );
}
