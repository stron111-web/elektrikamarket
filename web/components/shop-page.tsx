import Link from 'next/link';
import type { ReactNode } from 'react';
import { savedPage } from '../lib/pages';
import { currentPageEditor } from '../lib/staff';

export async function ShopPage({ slug, title, children }: { slug: string; title: string; children: ReactNode }) {
  const [saved, staff] = await Promise.all([savedPage(slug), currentPageEditor()]);
  const blocks = saved?.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean) ?? [];
  return (
    <article className="plain-page">
      <h1>
        {title}
        {staff ? (
          <Link className="page-pencil" href={`/admin/pages/${slug}`} aria-label="Редактировать">
            <Pencil />
          </Link>
        ) : null}
      </h1>
      {blocks.length ? blocks.map((block, index) => <p key={index}>{block}</p>) : children}
    </article>
  );
}

function Pencil() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20h4l10-10-4-4L4 16v4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M13 6l4 4" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
