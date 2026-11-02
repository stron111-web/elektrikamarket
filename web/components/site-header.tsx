'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AccountGate } from './account-gate';
import type { Buyer } from '../lib/session';
import { DepartmentIcon } from './department-icon';

const accountLinks = [
  { href: '/account', label: 'Профиль' },
  { href: '/account/orders', label: 'Мои заказы' },
  { href: '/favorites', label: 'Избранное' },
  { href: '/compare', label: 'Сравнение' },
];

const sectionLinks = [
  { href: '/about', label: 'О компании' },
  { href: '/delivery', label: 'Оплата и доставка' },
  { href: '/contacts', label: 'Контакты' },
];

type MenuCategory = { id: number; name: string; slug: string; parentId: number | null };
const categoryHref = (slug: string) => `/catalog?category=${encodeURIComponent(slug)}`;

export function SiteHeader({ buyer, compareCount, cartCount, categories }: { buyer: Buyer | null; compareCount: number; cartCount: number; categories: MenuCategory[] }) {
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [selectedRootId, setSelectedRootId] = useState<number | null>(null);
  const known = new Set(categories.map((category) => category.id));
  const roots = categories.filter((category) => category.parentId == null || !known.has(category.parentId));
  const activeRoot = roots.find((category) => category.id === selectedRootId) ?? roots[0];
  const groups = activeRoot ? categories.filter((category) => category.parentId === activeRoot.id) : [];

  useEffect(() => {
    document.documentElement.classList.toggle('catalog-open', catalogOpen);
    return () => document.documentElement.classList.remove('catalog-open');
  }, [catalogOpen]);

  return (
    <>
    <header className="site-header">
      <div className="topbar">
        <div className="container topbar-inner">
          <nav className="account-nav" aria-label="Покупатель">
            {accountLinks.map((link) => (
              <Link key={link.href} href={link.href}>
                {link.label}
                {link.href === '/compare' && compareCount > 0 ? <span className="count-badge">{compareCount}</span> : null}
              </Link>
            ))}
          </nav>
          <div className="topbar-tools">
            <AccountGate buyer={buyer} />
            <a className="max-link" href="https://max.ru/" target="_blank" rel="noopener noreferrer">
              <MaxMark />
              <span>Нажмите для связи через MAX</span>
            </a>
          </div>
        </div>
      </div>
      <div className="container header-main">
        <Link href="/" className="site-logo" aria-label="Электрика Маркет, на главную" onClick={() => setCatalogOpen(false)}>
          <img src="/brand/logo.png?v=2" alt="" />
        </Link>
        <form className="site-search" action="/catalog" method="get">
          <input name="q" aria-label="Поиск товаров" placeholder="Название, код или артикул товара" />
          <button type="submit">Найти</button>
        </form>
        <Link href="/cart" className="cart-link">
          <CartMark />
          <span>Корзина</span>
          {cartCount > 0 ? <span className="cart-count">{cartCount}</span> : null}
        </Link>
      </div>
      <div className="container section-nav">
        <button
          type="button"
          className={catalogOpen ? 'catalog-toggle open' : 'catalog-toggle'}
          aria-expanded={catalogOpen}
          onClick={() => setCatalogOpen((open) => !open)}
        >
          Каталог товаров
        </button>
        <nav aria-label="Разделы магазина">
          {sectionLinks.map((link) => (
            <Link key={link.href} href={link.href}>{link.label}</Link>
          ))}
        </nav>
      </div>
    </header>
    {catalogOpen && (
      <div className="catalog-panel">
        <div className="container catalog-screen">
          <nav className="home-departments category-menu-left" aria-label="Разделы каталога">
            <Link className="category-menu-all" href="/catalog" onClick={() => setCatalogOpen(false)}>Все разделы каталога</Link>
            {roots.map((root) => (
              <button type="button" key={root.id}
                className={activeRoot?.id === root.id ? 'category-menu-selected' : ''}
                aria-pressed={activeRoot?.id === root.id}
                onClick={() => setSelectedRootId(root.id)}>
                <span>{root.name}</span><span aria-hidden="true">›</span>
              </button>
            ))}
          </nav>
          <section className="catalog-submenu" aria-label="Подкатегории">
            {activeRoot ? (
              <>
                <div className="catalog-submenu-head">
                  <h2>{activeRoot.name}</h2>
                  <Link href={categoryHref(activeRoot.slug)} onClick={() => setCatalogOpen(false)}>Открыть раздел →</Link>
                </div>
                {groups.length ? (
                  <div className="catalog-submenu-grid">
                    {groups.map((group) => (
                      <div className="catalog-submenu-group" key={group.id}>
                        <Link className="catalog-submenu-title" href={categoryHref(group.slug)} onClick={() => setCatalogOpen(false)}>{group.name}</Link>
                        {categories.filter((child) => child.parentId === group.id).map((child) => (
                          <Link key={child.id} href={categoryHref(child.slug)} onClick={() => setCatalogOpen(false)}>{child.name}</Link>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : <p>Откройте раздел, чтобы посмотреть его товары.</p>}
              </>
            ) : <p>Разделы каталога временно недоступны.</p>}
          </section>
        </div>
      </div>
    )}
    </>
  );
}

function MaxMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#6a4dff" />
      <path fill="white" d="M8 11.5c0-1.4 1.2-2.5 2.6-2.5h8.2c2.6 0 4.7 2 4.7 4.6 0 2.5-2 4.5-4.6 4.6l-3.4 3.6c-.5.5-1.4.2-1.4-.5v-2.6h-3.5c-1.4 0-2.6-1.1-2.6-2.5v-4.7z" />
      <circle cx="13.2" cy="15.2" r="1.15" fill="#6a4dff" />
      <circle cx="17" cy="15.2" r="1.15" fill="#6a4dff" />
      <circle cx="20.8" cy="15.2" r="1.15" fill="#6a4dff" />
    </svg>
  );
}

function CartMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M6 8h3l2.2 11h12.4l2.2-8H12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="14" cy="24" r="1.8" fill="currentColor" />
      <circle cx="22" cy="24" r="1.8" fill="currentColor" />
    </svg>
  );
}
