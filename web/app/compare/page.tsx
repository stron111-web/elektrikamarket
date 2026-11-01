import type { Metadata } from 'next';
import Link from 'next/link';
import { Cabinet } from '../../components/cabinet';
import { productsForLists, type Item } from '../../lib/data';
import { money, number, unit } from '../../lib/format';
import { compareIds } from '../../lib/lists';
import { personalPriceMap } from '../../lib/personal-price';
import { currentBuyer } from '../../lib/session';

export const metadata: Metadata = { title: 'Сравнение' };
export const dynamic = 'force-dynamic';

type Stock = { warehouse?: string; quantity?: string; uom?: string };

function text(value: unknown) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map((part) => String(part)).filter(Boolean).join(', ');
  const raw = String(value).trim();
  return raw === '0' ? '' : raw;
}

function measure(value: unknown, measureUnit: unknown) {
  const amount = text(value);
  if (!amount || Number(amount) === 0) return '';
  return `${number(amount)} ${text(measureUnit)}`.trim();
}

function stockText(stocks: Stock[]) {
  if (!stocks.length) return 'Нет доступного остатка';
  return stocks.map((stock) => `${stock.warehouse ?? 'склад'}: ${number(stock.quantity)} ${unit(stock.uom ?? '')}`).join('; ');
}

export default async function ComparePage() {
  const buyer = await currentBuyer();
  const ids = await compareIds(buyer?.id);
  const products = await productsForLists(ids);
  const personal = await personalPriceMap(buyer, products.map(({ item }) => ({ id: item.id, retail: item.price?.retailPrice ?? null })));
  const rows = comparisonRows(products.map((entry) => entry.item), products.map((entry) => entry.packaging), buyer && buyer.status !== 'regular' ? personal : null);
  return (
    <Cabinet title="Сравнение" current="/compare">
      {products.length === 0 ? <p>Пока пусто. На карточке товара нажмите «Добавить в сравнение». В шапке у слова «Сравнение» загорится число.</p> : (
        <>
          <p>{products.length < 2 ? 'Добавьте ещё хотя бы один товар: отличия появятся, когда сравнивать будет с чем.' : 'Цветом отмечены строки, где значения разные. Одинаковые остаются без заливки.'}</p>
          <div className="compare-wrap">
            <table className="compare-table">
              <thead>
                <tr>
                  <th>Характеристика</th>
                  {products.map(({ item }) => <th key={item.id}><Link href={`/product/${item.slug}`}>{item.name}</Link></th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label} className={row.differs ? 'compare-diff' : undefined}>
                    <th>{row.label}</th>
                    {row.values.map((value, index) => <td key={products[index].item.id}>{value || '—'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Cabinet>
  );
}

function comparisonRows(
  items: Item[],
  packaging: ({ multiplicityRaw: string | null } | null)[],
  personal: Map<number, string | null> | null,
) {
  const valuesFor = (read: (item: Item, pack: { multiplicityRaw: string | null } | null) => string) => items.map((item, index) => read(item, packaging[index]));
  const specs: [string, (item: Item, pack: { multiplicityRaw: string | null } | null) => string][] = [
    ['Цена продажи', (item) => item.price ? money(item.price.retailPrice) : ''],
    ['Ваша цена', (item) => { const price = personal?.get(item.id); return price ? money(price) : ''; }],
    ['Единица продажи', (item) => item.price ? unit(item.price.uom) : ''],
    ['Кратность', (_item, pack) => text(pack?.multiplicityRaw)],
    ['Наличие', (item) => stockText((item.stocks ?? []) as Stock[])],
    ['Бренд', (item) => text(item.brand)],
    ['Артикул', (item) => text(item.vendorNumber)],
    ['Код', (item) => text(item.supplierCode)],
    ['Серия', (item) => text(item.series)],
    ['Страна', (item) => text(item.countries)],
    ['Гарантия', (item) => text(item.guaranteePeriod)],
    ['Вес', (item) => measure(item.weight, item.weightUnit)],
    ['Глубина', (item) => measure(item.depth, item.dimensionUnit)],
    ['Ширина', (item) => measure(item.width, item.dimensionUnit)],
    ['Высота', (item) => measure(item.height, item.dimensionUnit)],
    ['ТН ВЭД', (item) => text(item.tnved)],
    ['ОКПД2', (item) => text(item.okpd2)],
    ['ГОСТ', (item) => text(item.gost)],
    ['ТУ', (item) => text(item.ty)],
    ['Описание', (item) => text(item.description).slice(0, 280)],
  ];
  return specs.flatMap(([label, read]) => {
    const values = valuesFor(read);
    if (values.every((value) => !value)) return [];
    const differs = items.length > 1 && new Set(values).size > 1;
    return [{ label, values, differs }];
  });
}
