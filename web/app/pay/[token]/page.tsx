import { PayDesk } from '../../../components/pay-desk';
import { paymentPreview } from '../../../lib/cart';
import { money } from '../../../lib/format';

export const dynamic = 'force-dynamic';

export default async function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const payment = await paymentPreview(decodeURIComponent(token));
  if (!payment) return <section className="cart-page"><p>Это окно оплаты уже не действует.</p></section>;
  if (payment.status === 'cancelled') {
    return <section className="pay-desk"><h1>Оплата закрыта</h1><p>Корзина на сайте осталась. Можно закрыть это окно и оплатить снова.</p></section>;
  }
  if (payment.status === 'paid') {
    return <section className="pay-desk"><h1>Оплата уже прошла</h1><p>Это окно можно закрыть.</p></section>;
  }
  return <PayDesk token={token} amount={money(payment.amount)} />;
}