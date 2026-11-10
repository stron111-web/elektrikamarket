import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { lookupParty } from './dadata-core.cjs';

export type PartyCard = { company: string; address: string; kpp: string; ogrn: string };
type PartyResult = { ok: true; party: PartyCard } | { ok: false; message: string };
function devKey(name: string) {
  if (process.env.NODE_ENV !== 'development') return '';
  for (const root of [process.cwd(), path.join(process.cwd(), '..')]) {
    try { const value=fs.readFileSync(path.join(root,'deploy','dev','.local',name),'utf8').trim();if(value)return value; }
    catch { /* Optional developer-local files, never a production fallback. */ }
  }
  return '';
}
export async function findParty(inn: string): Promise<PartyResult> {
  return lookupParty(inn, {
    apiKey: (process.env.DADATA_API_KEY || devKey('dadata-api-key.txt')).trim(),
    secretKey: (process.env.DADATA_SECRET_KEY || devKey('dadata-secret-key.txt')).trim(),
  }) as Promise<PartyResult>;
}
