import Link from 'next/link';
import { CheckoutForm } from '../../../components/checkout-form';
import { loadCart } from '../../../lib/cart';
import { money } from '../../../lib/format';
import { currentBuyer } from '../../../lib/session';

export const dynamic = 'force-dynamic';

export default async function CheckoutPage() {
  const buyer = await currentBuyer();
  const cart = await loadCart(buyer);
  const name = buyer?.kind === 'individual'
    ? [buyer.firstName, buyer.lastName].filter(Boolean).join(' ')
    : buyer?.contactName ?? '';
  return (
    <section className="cart-page">
      <h1>Оформление</h1>
      <p><Link href="/cart">Вернуться в корзину</Link></p>
      {cart.payable === 0 ? (
        <p>Оплачивать пока нечего. <Link href="/catalog">В каталог</Link></p>
      ) : (
        <>
          <p>К оплате {money(cart.total)}, позиций: {cart.payable}.</p>
          {buyer ? (
            <p>Вы вошли как {buyer.name}. Заказ после оплаты появится в «Моих заказах».</p>
          ) : (
            <p>Без регистрации купить можно. Телефон и адрес нужны для этой доставки. Они не останутся в кабинете, пока вы сами не зарегистрируетесь.</p>
          )}
          <CheckoutForm
            name={name}
            phone={buyer?.phone ?? ''}
            email={buyer?.email ?? ''}
            emailLocked={Boolean(buyer)}
            company={buyer?.company ?? null}
          />
          <p className="account-notice">Пункт выдачи пока вводится своими словами. Справочник СДЭК и других компаний подключим следующим шагом, поля для него уже здесь: компания, адрес пункта, телефон и контактное лицо.</p>
        </>
      )}
    </section>
  );
}
