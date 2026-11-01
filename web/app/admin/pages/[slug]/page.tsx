import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { savePage } from '../../../../lib/admin-actions';
import { isPageSlug, pageSlugs, savedPage } from '../../../../lib/pages';
import { currentStaff } from '../../../../lib/staff';

export const dynamic = 'force-dynamic';

export default async function EditPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!(await currentStaff())) redirect('/admin');
  const { slug } = await params;
  if (!isPageSlug(slug)) notFound();
  const body = await savedPage(slug);
  return (
    <>
      <p><Link href="/admin/pages">Все страницы</Link></p>
      <h1>{pageSlugs[slug]}</h1>
      <form action={savePage} className="admin-editor">
        <input type="hidden" name="slug" value={slug} />
        <textarea name="body" rows={16} defaultValue={body ?? ''} aria-label="Текст страницы" placeholder="Новый текст. Пустое поле возвращает прежний утверждённый текст." />
        <button type="submit">Сохранить</button>
      </form>
      <p><Link href={`/${slug}`}>Открыть страницу</Link></p>
    </>
  );
}
