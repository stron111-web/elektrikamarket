import type { Metadata } from 'next';
import { Cabinet } from '../../components/cabinet';
import { ProfileForms } from '../../components/profile-forms';
import { savedDelivery } from '../../lib/saved-delivery';
import { currentBuyer } from '../../lib/session';

export const metadata: Metadata = { title: 'Профиль' };
export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const buyer = await currentBuyer();
  const delivery = buyer ? await savedDelivery(buyer.id) : null;
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
          <p>{delivery?.pointAddress ? `Пункт выдачи СДЭК: ${delivery.pointAddress}. Другой можно выбрать при следующем заказе.` : 'Пункт выдачи СДЭК пока не выбран. Он запомнится, когда выберете его при оформлении заказа.'}</p>
          <ProfileForms buyer={buyer} />
        </>
      )}
    </Cabinet>
  );
}
