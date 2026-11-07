import 'server-only';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { yandexPublicKey } from './yandex-public-key';

const gate = '123456';

export type StoredKeys = {
  cdekAccount: string;
  cdekPassword: string;
  javascript: string;
  geocoder: string;
};

function readNamed(name: string) {
  const roots = [process.cwd(), path.join(process.cwd(), '..')];
  for (const root of roots) {
    try {
      const value = fs.readFileSync(path.join(root, 'deploy', 'dev', '.local', name), 'utf8').trim();
      if (value) return value;
    } catch {
      continue;
    }
  }
  return '';
}

function first(...values: string[]) {
  return values.find((value) => value.trim())?.trim() ?? '';
}

export function keysBehindPassword(password: string): { ok: true; keys: StoredKeys } | { ok: false; message: string } {
  const typed = Buffer.from(password);
  const expected = Buffer.from(gate);
  const match = typed.length === expected.length && crypto.timingSafeEqual(typed, expected);
  if (!match) return { ok: false, message: 'Пароль не подошёл.' };
  return {
    ok: true,
    keys: {
      cdekAccount: first(process.env.CDEK_ACCOUNT ?? '', readNamed('cdek-account.txt')),
      cdekPassword: first(process.env.CDEK_SECURE_PASSWORD ?? '', readNamed('cdek-secure-password.txt')),
      javascript: first(process.env.YANDEX_JS_API_KEY ?? '', process.env.NEXT_PUBLIC_YANDEX_JS_API_KEY ?? '', yandexPublicKey, readNamed('yandex-js-api-key.txt')),
      geocoder: first(process.env.YANDEX_GEOCODER_API_KEY ?? '', readNamed('yandex-geocoder-api-key.txt')),
    },
  };
}
