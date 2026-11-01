import type { Metadata } from 'next';
import Link from 'next/link';
import { Cabinet } from '../../components/cabinet';
import { productsForLists } from '../../lib/data';
import { money } from '../../lib/format';
import { favoriteIds } from '../../lib/lists';
import { personalPriceMap } from '../../lib/personal-price';
import { currentBuyer } from '../../lib/session';

export const metadata: Metadata = { title: 'Избранное' };
export const dynamic = 'force-dynamic';

export default async function FavoritesPage() {
  const buyer = await currentBuyer();
  const ids = await favoriteIds(buyer?.id);
  const products = await productsForLists(ids);
  const personal = await personalPriceMap(buyer, products.map(({ item }) => ({ id: item.id, retail: item.price?.retailPrice ?? null })));
  return (
    <Cabinet title="Избранное" current="/favorites">
      <p>Сюда попадают товары, которые не хочется каждый раз искать в каталоге.</p>
      {products.length === 0 ? <p>Пока пусто. На карточке товара есть кнопка «В избранное».</p> : (
        <ul className="favorite-list">
          {products.map(({ item }) => {
            const yourPrice = buyer && buyer.status !== 'regular' ? personal.get(item.id) ?? null : null;
            return (
              <li key={item.id}>
                <Link href={`/product/${item.slug}`}>{item.name}</Link>
                <span>{item.price ? money(item.price.retailPrice) : 'Нет цены'}</span>
                {yourPrice ? <span>Ваша цена {money(yourPrice)}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
    </Cabinet>
  );
}
