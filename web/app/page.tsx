import Link from 'next/link';
import { departmentHref, departments } from '../lib/departments';
import { catalogCategories } from '../lib/data';

export default async function Home() {
  const categories = await catalogCategories();
  return (
    <div className="home-layout">
      <h1 className="visually-hidden">Электрика Маркет</h1>
      <nav className="home-departments" aria-label="Разделы каталога">
        {departments.map((department) => (
          <Link key={department.id} href={departmentHref(department, categories)}>{department.name}</Link>
        ))}
      </nav>
      <Link href="/estimate" className="petrovich">
        <img src="/brand/petrovich.jpg?v=5" alt="Петрович: пришлите смету в любом формате, подберём по вашему списку" />
      </Link>
    </div>
  );
}
