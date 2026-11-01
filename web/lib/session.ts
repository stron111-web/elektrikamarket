import 'server-only';
import { cookies } from 'next/headers';
import { hashToken, newSessionToken, shop } from './shop';

export type Buyer = {
  id: string;
  email: string;
  phone: string;
  kind: 'individual' | 'organization' | 'entrepreneur';
  status: 'regular' | 'discount' | 'markup';
  discountPercent: string;
  markupPercent: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  inn: string | null;
  company: string | null;
  legalAddress: string | null;
  kpp: string | null;
  ogrn: string | null;
  contactName: string | null;
};

const cookieName = 'em_session';

export async function currentBuyer(): Promise<Buyer | null> {
  if (!process.env.SHOP_DATABASE_URL) return null;
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  try {
    const rows = await shop()<Buyer[]>`
      SELECT b.id::text, b.email, b.phone, b.kind, b.status,
        b.discount_percent::text AS "discountPercent", b.markup_percent::text AS "markupPercent",
        COALESCE(o.name, p.first_name, b.email) AS name,
        p.first_name AS "firstName", p.last_name AS "lastName",
        o.inn, o.name AS company, o.legal_address AS "legalAddress", o.kpp, o.ogrn, o.contact_name AS "contactName"
      FROM sessions s
      JOIN buyers b ON b.id = s.buyer_id
      LEFT JOIN individual_profiles p ON p.buyer_id = b.id
      LEFT JOIN organizations o ON o.buyer_id = b.id
      WHERE s.token_hash = ${hashToken(token)} AND s.expires_at > now()
      LIMIT 1`;
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function openSession(buyerId: string) {
  const { token, hash } = newSessionToken();
  await shop()`INSERT INTO sessions (buyer_id, token_hash, expires_at) VALUES (${buyerId}, ${hash}, now() + interval '30 days')`;
  (await cookies()).set(cookieName, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30, secure: process.env.NODE_ENV === 'production' });
}

export async function closeSession() {
  const jar = await cookies();
  const token = jar.get(cookieName)?.value;
  if (token && process.env.SHOP_DATABASE_URL) {
    try { await shop()`DELETE FROM sessions WHERE token_hash = ${hashToken(token)}`; } catch { /* вход всё равно закрываем */ }
  }
  jar.delete(cookieName);
}
