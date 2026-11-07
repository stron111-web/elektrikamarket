'use server';

import { findParty } from './dadata';

export async function findCompanyByInn(inn: string) {
  const clean = inn.trim();
  if (!/^\d{10}$|^\d{12}$/.test(clean)) return { ok: false as const, message: 'ИНН — 10 или 12 цифр.' };
  const result = await findParty(clean);
  if (!result.ok) return result;
  return { ok: true as const, ...result.party };
}
