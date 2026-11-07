'use server';

import { keysBehindPassword } from './key-store';
import { currentStaff } from './staff';

export async function openKeyStore(password: string) {
  if (!(await currentStaff())) return { ok: false as const, message: 'Сначала войдите в админку.' };
  return keysBehindPassword(password);
}
