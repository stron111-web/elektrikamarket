'use client';
export default function ErrorPage({ reset }: { reset: () => void }) { return <section className="empty"><h1>Не удалось загрузить каталог</h1><p>Повторите попытку через несколько секунд.</p><button onClick={reset}>Повторить</button></section>; }
