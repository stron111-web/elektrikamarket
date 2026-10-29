import Link from 'next/link';
export default function NotFound() { return <section className="empty"><h1>Товар не найден</h1><p>Возможно, ссылка устарела или товар снят с публикации.</p><Link href="/catalog">Открыть каталог</Link></section>; }
