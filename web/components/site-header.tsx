'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AccountGate } from './account-gate';
import { DepartmentIcon } from './department-icon';
import { departmentHref, departments } from '../lib/departments';

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

export function SiteHeader() {
  const [catalogOpen, setCatalogOpen] = useState(false);

  return (
    <header className="site-header">
      <div className="topbar">
        <div className="container topbar-inner">
          <nav className="account-nav" aria-label="Покупатель">
            {accountLinks.map((link) => (
              <Link key={link.href} href={link.href}>{link.label}</Link>
            ))}
          </nav>
          <div className="topbar-tools">
            <AccountGate />
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
      {catalogOpen && (
        <div className="catalog-panel">
          <div className="container catalog-grid">
            {departments.map((department) => (
              <Link key={department.id} href={departmentHref(department)} className="catalog-card" onClick={() => setCatalogOpen(false)}>
                <DepartmentIcon id={department.id} />
                <span>{department.name}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
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
