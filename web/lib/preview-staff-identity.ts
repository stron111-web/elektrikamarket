// Only enable behind the existing site-wide Caddy Basic Auth, with no published
// application port. Caddy validates the Authorization header before forwarding.
// This resolves identity; the staff table remains the authorization allowlist.
export function previewStaffEmail(authorization: string | null, env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.PREVIEW_STAFF_BASIC_AUTH !== '1' || env.STOREFRONT_DATABASE_ROLE !== 'storefront_preview_ro') return null;
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization ?? '');
  if (!match || match[1].length > 4096) return null;
  const value = Buffer.from(match[1], 'base64').toString('utf8');
  const colon = value.indexOf(':');
  if (colon < 1 || colon === value.length - 1) return null;
  const username = value.slice(0, colon);
  if (username !== 'owner' && username !== 'developer') return null;
  let map: unknown;
  try { map = JSON.parse(env.PREVIEW_STAFF_MAP ?? '{}'); } catch { return null; }
  if (!map || typeof map !== 'object' || Array.isArray(map) || !Object.hasOwn(map, username)) return null;
  const email = (map as Record<string, unknown>)[username];
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.toLowerCase() : null;
}
