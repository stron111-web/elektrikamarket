import 'server-only';
import fs from 'fs';
import path from 'path';

export type PartyCard = {
  company: string;
  address: string;
  kpp: string;
  ogrn: string;
};

type Party = {
  kpp?: string | null;
  ogrn?: string | null;
  name?: { short_with_opf?: string | null; full_with_opf?: string | null };
  address?: { unrestricted_value?: string | null; value?: string | null };
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

export function dadataApiKey() {
  return (process.env.DADATA_API_KEY || readNamed('dadata-api-key.txt')).trim();
}

export function dadataSecretKey() {
  return (process.env.DADATA_SECRET_KEY || readNamed('dadata-secret-key.txt')).trim();
}

export async function findParty(inn: string): Promise<{ ok: true; party: PartyCard } | { ok: false; message: string }> {
  const token = dadataApiKey();
  const secret = dadataSecretKey();
  if (!token) return { ok: false, message: 'Справочник по ИНН на этом запуске не подключён.' };
  let response: Response;
  try {
    response = await fetch('https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Token ${token}`,
        ...(secret ? { 'X-Secret': secret } : {}),
      },
      body: JSON.stringify({ query: inn }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { ok: false, message: 'Справочник не ответил. Реквизиты можно ввести вручную.' };
  }
  if (!response.ok) return { ok: false, message: 'Справочник не ответил. Реквизиты можно ввести вручную.' };
  const body = await response.json() as { suggestions?: Array<{ data?: Party }> };
  const data = body.suggestions?.[0]?.data;
  if (!data) return { ok: false, message: 'По этому ИНН справочник организацию не нашёл. Реквизиты введите вручную.' };
  const party = {
    company: (data.name?.short_with_opf || data.name?.full_with_opf || '').trim(),
    address: (data.address?.unrestricted_value || data.address?.value || '').trim(),
    kpp: (data.kpp || '').trim(),
    ogrn: (data.ogrn || '').trim(),
  };
  if (!party.company && !party.address) return { ok: false, message: 'Справочник не вернул название и адрес. Введите реквизиты вручную.' };
  return { ok: true, party };
}
