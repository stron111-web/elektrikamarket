import 'server-only';
import { cookies, headers } from 'next/headers';
import { hashToken, newSessionToken, shop } from './shop';
import { previewStaffEmail } from './preview-staff-identity';

const cookieName = 'em_staff';

export type Staff = { id: string; email: string; name: string };

export async function currentStaff(): Promise<Staff | null> {
  if (!process.env.SHOP_DATABASE_URL) return null;
  if (process.env.PREVIEW_STAFF_BASIC_AUTH === '1') {
    const email = previewStaffEmail((await headers()).get('authorization'));
    if (!email) return null;
    const rows = await shop()<Staff[]>`SELECT id::text, email, name FROM staff WHERE email = ${email} LIMIT 1`;
    return rows[0] ?? null;
  }
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  try {
    const rows = await shop()<Staff[]>`
      SELECT s.id::text, s.email, s.name
      FROM staff_sessions n
      JOIN staff s ON s.id = n.staff_id
      WHERE n.token_hash = ${hashToken(token)} AND n.expires_at > now()
      LIMIT 1`;
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function openStaffSession(staffId: string) {
  const { token, hash } = newSessionToken();
  await shop()`INSERT INTO staff_sessions (staff_id, token_hash, expires_at) VALUES (${staffId}, ${hash}, now() + interval '12 hours')`;
  (await cookies()).set(cookieName, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 12, secure: process.env.NODE_ENV === 'production' });
}

export async function closeStaffSession() {
  const jar = await cookies();
  const token = jar.get(cookieName)?.value;
  if (token && process.env.SHOP_DATABASE_URL) {
    try { await shop()`DELETE FROM staff_sessions WHERE token_hash = ${hashToken(token)}`; } catch { /* вход всё равно закрываем */ }
  }
  jar.delete(cookieName);
}
