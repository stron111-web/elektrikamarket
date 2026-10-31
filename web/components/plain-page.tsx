import type { ReactNode } from 'react';

export function PlainPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="plain-page">
      <h1>{title}</h1>
      {children}
    </article>
  );
}
