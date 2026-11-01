import type { Metadata } from 'next';
import { Cabinet } from '../../components/cabinet';
import { ProfileForms } from '../../components/profile-forms';
import { currentBuyer } from '../../lib/session';

export const metadata: Metadata = { title: 'Профиль' };
export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const buyer = await currentBuyer();
  return (
    <Cabinet title="Профиль" current="/account">
      {!buyer ? (
        <p>Войдите, чтобы открыть профиль. Кнопка «Войти» справа в шапке.</p>
      ) : (
        <>
          <p className="status-line">
            {buyer.status === 'discount'
              ? `Клиент со скидкой ${buyer.discountPercent.replace(/\.00$/, '')}%. Скидка считается от розничной цены. Назначает её магазин.`
              : buyer.status === 'markup'
                ? `Клиент с наценкой ${buyer.markupPercent.replace(/\.00$/, '')}%. Наценка задаётся магазином, закупочная цена в кабинете не показывается.`
                : 'Обычный клиент. Статус назначает магазин, в кабинете его не изменить.'}
          </p>
          <ProfileForms buyer={buyer} />
        </>
      )}
    </Cabinet>
  );
}
