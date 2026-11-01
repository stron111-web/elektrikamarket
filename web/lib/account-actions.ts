'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { rememberGuestCart } from './cart';
import { rememberGuestLists } from './lists';
import { checkPassword, hashPassword, shop } from './shop';
import { closeSession, currentBuyer, openSession } from './session';

export type AuthResult = { ok: true } | { ok: false; message: string };

type RegisterInput = {
  kind: 'person' | 'company';
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  password?: string;
  repeat?: string;
  inn?: string;
  company?: string;
  address?: string;
  kpp?: string;
  ogrn?: string;
  contact?: string;
};

function clean(value: string | undefined) {
  return (value ?? '').trim();
}

function emailOk(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function registerAccount(input: RegisterInput): Promise<AuthResult> {
  const email = clean(input.email).toLowerCase();
  const phone = clean(input.phone);
  const password = input.password ?? '';
  const repeat = input.repeat ?? '';
  if (!emailOk(email)) return { ok: false, message: 'Укажите e-mail. Он же будет логином.' };
  if (!phone) return { ok: false, message: 'Укажите телефон.' };
  if (password.length < 6) return { ok: false, message: 'Пароль не короче 6 знаков.' };
  if (password !== repeat) return { ok: false, message: 'Пароли не совпали.' };

  const kind = input.kind === 'company' ? 'organization' : 'individual';
  const firstName = clean(input.firstName);
  const lastName = clean(input.lastName);
  const inn = clean(input.inn);
  const company = clean(input.company);
  const address = clean(input.address);
  const kpp = clean(input.kpp);
  const ogrn = clean(input.ogrn);
  const contact = clean(input.contact);

  if (kind === 'individual' && !firstName) return { ok: false, message: 'Укажите имя.' };
  if (kind === 'organization') {
    if (!/^\d{10}$|^\d{12}$/.test(inn)) return { ok: false, message: 'ИНН — 10 или 12 цифр.' };
    if (!company || !address || !kpp || !ogrn || !contact) return { ok: false, message: 'Заполните все поля организации.' };
  }

  const passwordHash = await hashPassword(password);
  try {
    const buyerId = await shop().begin(async (tx) => {
      const rows = await tx<{ id: string }[]>`
        INSERT INTO buyers (email, phone, password_hash, kind)
        VALUES (${email}, ${phone}, ${passwordHash}, ${kind})
        RETURNING id::text`;
      const id = rows[0].id;
      if (kind === 'individual') {
        await tx`INSERT INTO individual_profiles (buyer_id, first_name, last_name) VALUES (${id}, ${firstName}, ${lastName || null})`;
      } else {
        await tx`
          INSERT INTO organizations (buyer_id, inn, name, legal_address, kpp, ogrn, contact_name)
          VALUES (${id}, ${inn}, ${company}, ${address}, ${kpp}, ${ogrn}, ${contact})`;
      }
      return id;
    });
    await openSession(buyerId);
    await rememberGuestLists(buyerId);
    await rememberGuestCart(buyerId);
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: string }).code) : '';
    const constraint = typeof error === 'object' && error && 'constraint_name' in error ? String((error as { constraint_name: string }).constraint_name) : '';
    if (code === '23505' && constraint.includes('inn')) return { ok: false, message: 'Организация с таким ИНН уже зарегистрирована.' };
    if (code === '23505') return { ok: false, message: 'Такая почта уже зарегистрирована. Войдите с ней.' };
    return { ok: false, message: 'Не удалось сохранить анкету. Попробуйте ещё раз.' };
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function loginAccount(login: string, password: string): Promise<AuthResult> {
  const email = login.trim().toLowerCase();
  if (!email || !password) return { ok: false, message: 'Введите логин и пароль.' };
  const rows = await shop()<{ id: string; password_hash: string }[]>`SELECT id::text, password_hash FROM buyers WHERE email = ${email} LIMIT 1`;
  const buyer = rows[0];
  if (!buyer || !(await checkPassword(password, buyer.password_hash))) return { ok: false, message: 'Неверная почта или пароль.' };
  await openSession(buyer.id);
  await rememberGuestLists(buyer.id);
  await rememberGuestCart(buyer.id);
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function logoutAccount() {
  await closeSession();
  revalidatePath('/', 'layout');
  redirect('/');
}

export async function updateProfile(input: { phone: string; firstName?: string; lastName?: string; company?: string; address?: string; kpp?: string; ogrn?: string; contact?: string; inn?: string }): Promise<AuthResult> {
  const buyer = await currentBuyer();
  if (!buyer) return { ok: false, message: 'Сначала войдите.' };
  const phone = input.phone.trim();
  if (!phone) return { ok: false, message: 'Укажите телефон.' };
  try {
    await shop().begin(async (tx) => {
      await tx`UPDATE buyers SET phone = ${phone} WHERE id = ${buyer.id}`;
      if (buyer.kind === 'individual') {
        const firstName = (input.firstName ?? '').trim();
        if (!firstName) throw new Error('name');
        const lastName = (input.lastName ?? '').trim();
        await tx`UPDATE individual_profiles SET first_name = ${firstName}, last_name = ${lastName || null} WHERE buyer_id = ${buyer.id}`;
      } else {
        const inn = (input.inn ?? '').trim();
        const company = (input.company ?? '').trim();
        const address = (input.address ?? '').trim();
        const kpp = (input.kpp ?? '').trim();
        const ogrn = (input.ogrn ?? '').trim();
        const contact = (input.contact ?? '').trim();
        if (!/^\d{10}$|^\d{12}$/.test(inn) || !kpp) throw new Error('org');
        if (!company || !address || !ogrn || !contact) throw new Error('org');
        await tx`
          UPDATE organizations
          SET inn = ${inn}, name = ${company}, legal_address = ${address}, kpp = ${kpp}, ogrn = ${ogrn}, contact_name = ${contact}
          WHERE buyer_id = ${buyer.id}`;
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'name') return { ok: false, message: 'Укажите имя.' };
    if (error instanceof Error && error.message === 'org') return { ok: false, message: 'Заполните реквизиты. ИНН — 10 или 12 цифр.' };
    const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: string }).code) : '';
    if (code === '23505') return { ok: false, message: 'Организация с таким ИНН уже зарегистрирована.' };
    return { ok: false, message: 'Не удалось сохранить профиль.' };
  }
  revalidatePath('/account');
  return { ok: true };
}

export async function changePassword(current: string, next: string, repeat: string): Promise<AuthResult> {
  const buyer = await currentBuyer();
  if (!buyer) return { ok: false, message: 'Сначала войдите.' };
  if (next.length < 6) return { ok: false, message: 'Новый пароль не короче 6 знаков.' };
  if (next !== repeat) return { ok: false, message: 'Пароли не совпали.' };
  const rows = await shop()<{ password_hash: string }[]>`SELECT password_hash FROM buyers WHERE id = ${buyer.id}`;
  if (!rows[0] || !(await checkPassword(current, rows[0].password_hash))) return { ok: false, message: 'Старый пароль не подошёл.' };
  const passwordHash = await hashPassword(next);
  await shop()`UPDATE buyers SET password_hash = ${passwordHash} WHERE id = ${buyer.id}`;
  return { ok: true };
}
