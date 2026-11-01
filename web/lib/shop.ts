import 'server-only';
import crypto from 'node:crypto';
import postgres from 'postgres';

const globalShop = globalThis as unknown as { shopDb?: ReturnType<typeof postgres> };

export function shop() {
  const raw = process.env.SHOP_DATABASE_URL;
  if (!raw) throw new Error('SHOP_DATABASE_URL is required on the server');
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Shop database must be PostgreSQL');
  url.searchParams.delete('schema');
  return globalShop.shopDb ??= postgres(url.toString(), {
    max: 4,
    idle_timeout: 20,
    connect_timeout: 10,
    connection: { application_name: 'elektrikamarket-shop', search_path: 'shop' },
    onnotice: () => {},
  });
}

function scrypt(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 32, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function checkPassword(password: string, stored: string) {
  const [kind, salt, key] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !key) return false;
  const actual = await scrypt(password, Buffer.from(salt, 'base64url'));
  const expected = Buffer.from(key, 'base64url');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

export function newSessionToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

export function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
