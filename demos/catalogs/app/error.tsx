'use client';
export default function ErrorPage({ reset }: { reset: () => void }) { return <main className="container demo-error"><h1>Не удалось открыть каталог</h1><p>Данные временно недоступны. Рабочий магазин продолжает работать отдельно.</p><button onClick={reset}>Попробовать снова</button></main>; }
