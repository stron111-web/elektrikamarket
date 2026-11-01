import { redirect } from 'next/navigation';
import { saveClient } from '../../../lib/admin-actions';
import { shop } from '../../../lib/shop';
import { currentStaff } from '../../../lib/staff';

export const dynamic = 'force-dynamic';

const kindText: Record<string, string> = { individual: 'Физическое лицо', organization: 'Юридическое лицо', entrepreneur: 'Юридическое лицо' };

type Client = {
  id: string;
  email: string;
  phone: string;
  kind: string;
  status: string;
  discountPercent: string;
  markupPercent: string;
  name: string;
};

export default async function AdminClients() {
  if (!(await currentStaff())) redirect('/admin');
  const clients = await shop()<Client[]>`
    SELECT b.id::text, b.email, b.phone, b.kind, b.status,
      b.discount_percent::text AS "discountPercent", b.markup_percent::text AS "markupPercent",
      COALESCE(o.name, NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''), b.email) AS name
    FROM buyers b
    LEFT JOIN individual_profiles p ON p.buyer_id = b.id
    LEFT JOIN organizations o ON o.buyer_id = b.id
    ORDER BY b.id DESC`;
  return (
    <>
      <h1>Клиенты</h1>
      <p>Скидка считается от розницы. Наценка считается от закупки, саму закупку здесь не показываем. Обычный клиент идёт по рознице.</p>
      {clients.length === 0 ? <p>Зарегистрированных клиентов пока нет.</p> : (
        <ul className="admin-orders">
          {clients.map((client) => {
            const percent = client.status === 'markup' ? client.markupPercent : client.status === 'discount' ? client.discountPercent : '';
            return (
              <li key={client.id}>
                <div>
                  <b>{client.name}</b>
                  <span>{kindText[client.kind] ?? client.kind}</span>
                </div>
                <p>{client.email} · {client.phone}</p>
                <form action={saveClient} className="admin-inline">
                  <input type="hidden" name="id" value={client.id} />
                  <select name="status" defaultValue={client.status} aria-label="Статус клиента">
                    <option value="regular">Обычный</option>
                    <option value="discount">Скидка, %</option>
                    <option value="markup">Наценка, %</option>
                  </select>
                  <input name="percent" defaultValue={percent.replace(/\.00$/, '')} inputMode="decimal" placeholder="Процент" aria-label="Процент" />
                  <button type="submit">Сохранить</button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
