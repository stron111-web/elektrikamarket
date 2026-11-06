'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { handoffOrder } from './cdek-handoff';
import { isPreviewStore } from './preview-store';
import { checkPassword, shop } from './shop';
import { closeStaffSession, currentStaff, openStaffSession } from './staff';
import { isPageSlug, pageSlugs } from './pages';

export async function loginStaff(email: string, password: string) {
  const login = email.trim().toLowerCase();
  if (!login || !password) return { ok: false as const, message: 'Введите почту и пароль.' };
  const rows = await shop()<{ id: string; password_hash: string }[]>`SELECT id::text, password_hash FROM staff WHERE email = ${login} LIMIT 1`;
  const staff = rows[0];
  if (!staff || !(await checkPassword(password, staff.password_hash))) return { ok: false as const, message: 'Неверная почта или пароль.' };
  await openStaffSession(staff.id);
  return { ok: true as const };
}

export async function logoutStaff() {
  await closeStaffSession();
  redirect('/admin');
}

export async function saveClient(formData: FormData) {
  if (!(await currentStaff())) redirect('/admin');
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  const percent = Number(String(formData.get('percent') ?? '').replace(',', '.'));
  if (!/^\d+$/.test(id)) return;
  let discount = 0;
  let markup = 0;
  if (status === 'regular') {
    discount = 0;
    markup = 0;
  } else if (status === 'discount' && percent > 0 && percent <= 100) {
    discount = Math.round(percent * 100) / 100;
  } else if (status === 'markup' && percent > 0 && percent <= 1000) {
    markup = Math.round(percent * 100) / 100;
  } else {
    return;
  }
  await shop()`
    UPDATE buyers
    SET status = ${status}, discount_percent = ${discount}, markup_percent = ${markup}
    WHERE id = ${id}`;
  revalidatePath('/admin/clients');
  revalidatePath('/', 'layout');
}

export async function saveOrder(formData: FormData) {
  if (!(await currentStaff())) redirect('/admin');
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  const note = String(formData.get('note') ?? '').trim().slice(0, 500);
  if (!/^\d+$/.test(id)) return;
  if (!['placed', 'paid', 'sent', 'cancelled', 'unpaid'].includes(status)) return;
  await shop()`UPDATE orders SET status = ${status}, staff_note = ${note || null} WHERE id = ${id}`;
  revalidatePath('/admin/orders');
  revalidatePath('/account/orders');
}

export async function sendToCdek(formData: FormData) {
  if (!(await currentStaff())) redirect('/admin');
  if (!isPreviewStore()) redirect('/admin/orders');
  const id = String(formData.get('id') ?? '');
  if (!/^\d+$/.test(id)) return;
  const result = await handoffOrder(id);
  revalidatePath('/admin/orders');
  return result.ok ? { ok: true as const, message: result.text } : { ok: false as const, message: result.message };
}

export async function savePage(formData: FormData) {
  if (!(await currentStaff())) redirect('/admin');
  const slug = String(formData.get('slug') ?? '');
  if (!isPageSlug(slug)) return;
  const body = String(formData.get('body') ?? '').trim();
  if (!body) {
    await shop()`DELETE FROM pages WHERE slug = ${slug}`;
  } else {
    await shop()`
      INSERT INTO pages (slug, title, body)
      VALUES (${slug}, ${pageSlugs[slug]}, ${body})
      ON CONFLICT (slug) DO UPDATE SET body = EXCLUDED.body, title = EXCLUDED.title, updated_at = now()`;
  }
  revalidatePath('/admin/pages');
  revalidatePath(`/${slug}`);
  redirect(`/admin/pages/${slug}`);
}
