import Link from 'next/link';
import { CartQty, ClearCart } from '../../components/cart-controls';
import { loadCart } from '../../lib/cart';
import { money } from '../../lib/format';
import { currentBuyer } from '../../lib/session';

export const dynamic = 'force-dynamic';

export default async function CartPage() {
  const buyer = await currentBuyer();
  const cart = await loadCart(buyer);
  return (
    <section className="cart-page">
      <h1>Корзина</h1>
      {cart.lines.length === 0 ? (
        <p>Корзина пустая. <Link href="/catalog">Перейти в каталог</Link></p>
      ) : (
        <>
          <ul className="cart-lines">
            {cart.lines.map((line) => (
              <li key={line.productId} className={line.available ? undefined : 'muted-line'}>
                <div className="cart-name">
                  {line.slug ? <Link href={`/product/${line.slug}`}>{line.name}</Link> : <b>{line.name}</b>}
                  {line.retailPrice && line.unitPrice && line.retailPrice !== line.unitPrice ? <p className="your-price">Ваша цена уже в сумме. Розница {money(line.retailPrice)}</p> : null}
                  {line.notice ? <p className="cart-line-note">{line.notice}</p> : null}
                </div>
                <CartQty productId={line.productId} quantity={line.quantity} />
                {line.lineTotal ? <b className="cart-line-sum">{money(line.lineTotal)}</b> : <span />}
              </li>
            ))}
          </ul>
          <p className="cart-total"><span className="cart-line-sum">К оплате: {money(cart.total)}</span></p>
          <div className="cart-actions">
            <Link className="secondary" href="/catalog">Продолжить покупки</Link>
            <ClearCart />
            {cart.payable > 0 ? <Link href="/cart/checkout">Перейти к оформлению</Link> : null}
          </div>
          <p className="account-notice">Регистрация для покупки не нужна. Вошедший покупатель оформляет ту же корзину, и заказ остаётся в кабинете. Оплата откроется отдельным окном, корзина не сотрётся, пока деньги не списаны.</p>
        </>
      )}
    </section>
  );
}
