import 'server-only';
import { cdekShipmentPoint } from './cdek-origin';

const liveApi = 'https://api.cdek.ru/v2';
const studyApi = 'https://api.edu.cdek.ru/v2';
const studyAccount = 'wqGwiQx0gg8mLtiEKsUinjVSICCjtTEP';
const studySecret = 'RmAmgvSgSl1yirlz9QupbzOJVqhCxcP5';

type CityRow = { code?: number; city?: string; region?: string; latitude?: number; longitude?: number };
type PointRow = { code?: string; is_reception?: boolean; location?: { address?: string; address_full?: string; city?: string; city_code?: number; latitude?: number; longitude?: number }; work_time?: string };
type Tariff = { tariff_code?: number; tariff_name?: string; delivery_mode?: number; delivery_sum?: number; period_min?: number; period_max?: number };

export type CdekCity = { code: number; city: string; region: string; latitude: number; longitude: number };
export type CdekPoint = { code: string; address: string; city: string; latitude: number; longitude: number; hours: string };
export type CdekPackage = { weight: number; length: number; width: number; height: number };

let session: { value: string; until: number; base: string; study: boolean } | null = null;
let originCity: number | null = null;

function keys() {
  const id = process.env.CDEK_ACCOUNT?.trim();
  const secret = process.env.CDEK_SECURE_PASSWORD?.trim();
  if (!id || !secret) return null;
  return { id, secret };
}

function fail(error: unknown) {
  if (error instanceof Error && error.message === 'offline') return 'СДЭК на этом запуске сайта не подключён.';
  if (error instanceof Error && error.message === 'auth') return 'СДЭК не принял ключ. Новый ключ создавать не нужно.';
  if (error instanceof Error && error.message === 'origin') return 'СДЭК не подтвердил, что пункт TLT12 на Коммунальной, 20 стр. 7 принимает отправления.';
  return 'СДЭК сейчас не ответил. Попробуйте ещё раз.';
}

async function login(base: string, id: string, secret: string) {
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret });
  const response = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('auth');
  const json = await response.json() as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error('auth');
  return { value: json.access_token, until: Date.now() + Math.max(60, (json.expires_in ?? 3600) - 120) * 1000, base };
}

async function connect() {
  if (session && session.until > Date.now()) return session;
  const pair = keys();
  if (pair) {
    const live = await login(liveApi, pair.id, pair.secret);
    session = { ...live, study: false };
    return session;
  }
  const study = await login(studyApi, studyAccount, studySecret);
  session = { ...study, study: true };
  return session;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const current = await connect();
  const response = await fetch(current.base + path, {
    ...init,
    headers: {
      authorization: `Bearer ${current.value}`,
      accept: 'application/json',
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
    },
    signal: AbortSignal.timeout(20000),
  });
  if (response.status === 401) {
    session = null;
    throw new Error('auth');
  }
  if (!response.ok) throw new Error('http');
  return response.json() as Promise<T>;
}

function money(value: number) {
  if (!Number.isFinite(value) || value < 0) throw new Error('sum');
  return value.toFixed(2);
}

async function originCityCode() {
  if (originCity) return originCity;
  const rows = await call<PointRow[]>(`/deliverypoints?code=${encodeURIComponent(cdekShipmentPoint)}`);
  const row = rows.find((item) => item.code === cdekShipmentPoint);
  const code = row?.location?.city_code;
  if (!row || row.is_reception !== true || !code) throw new Error('origin');
  originCity = code;
  return code;
}

type SuggestRow = { code?: number; city?: string; full_name?: string };

function rankCity(name: string, needle: string) {
  const title = name.toLowerCase();
  const parts = title.split(/[\s,.-]+/).filter(Boolean);
  if (title.startsWith(needle) || parts[0]?.startsWith(needle)) return 0;
  if (parts.some((part) => part.startsWith(needle))) return 1;
  return 3;
}

function listedCities(rows: CityRow[], needle: string) {
  return rows.flatMap((row) => {
    if (!row.code || !row.city || row.latitude == null || row.longitude == null) return [];
    return [{ code: row.code, city: row.city, region: row.region ?? '', latitude: row.latitude, longitude: row.longitude }];
  }).sort((a, b) => rankCity(a.city, needle) - rankCity(b.city, needle) || a.city.localeCompare(b.city, 'ru'));
}

async function suggestedCities(city: string, needle: string) {
  const raw = await call<SuggestRow[] | SuggestRow>(`/location/suggest/cities?name=${encodeURIComponent(city)}&country_code=RU`);
  const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return rows.flatMap((row) => {
    if (!row.code) return [];
    const full = (row.full_name || row.city || '').trim();
    if (!full) return [];
    const clean = (value: string) => value.replace(/^г\.\s*/i, '').trim();
    const parts = full.split(',').map(clean).filter(Boolean);
    const name = parts.find((part) => rankCity(part, needle) < 2) ?? clean(row.city ?? '') ?? parts[0];
    if (!name) return [];
    const region = parts.filter((part) => part !== name && part !== 'Россия').join(', ');
    return [{ code: row.code, city: clean(row.city || name), region, latitude: 0, longitude: 0 }];
  }).sort((a, b) => rankCity(a.city, needle) - rankCity(b.city, needle) || a.city.localeCompare(b.city, 'ru'));
}

export async function findCities(raw: string): Promise<{ ok: true; cities: CdekCity[]; study: boolean } | { ok: false; message: string }> {
  const city = raw.trim().replace(/\s+/g, ' ');
  if (!/^[\p{L}][\p{L}\s-]{1,59}$/u.test(city)) return { ok: false, message: 'Введите название города.' };
  const needle = city.toLowerCase();
  try {
    let cities: CdekCity[] = [];
    try {
      cities = await suggestedCities(city, needle);
    } catch {
      cities = [];
    }
    if (!cities.length) {
      const rows = await call<CityRow[]>(`/location/cities?country_codes=RU&city=${encodeURIComponent(city)}&size=50`);
      cities = listedCities(rows, needle);
    }
    cities = cities.filter((item) => rankCity(item.city, needle) < 2).slice(0, 12);
    if (!cities.length) return { ok: false, message: 'СДЭК не нашёл такой город.' };
    return { ok: true, cities, study: session?.study === true };
  } catch (error) {
    return { ok: false, message: fail(error) };
  }
}

export async function cityByCode(code: number): Promise<CdekCity | null> {
  if (!Number.isInteger(code) || code <= 0) return null;
  try {
    const rows = await call<CityRow[]>(`/location/cities?code=${code}`);
    const row = rows.find((item) => item.code === code) ?? rows[0];
    if (!row?.code || !row.city || row.latitude == null || row.longitude == null) return null;
    return { code: row.code, city: row.city, region: row.region ?? '', latitude: row.latitude, longitude: row.longitude };
  } catch {
    return null;
  }
}

type OpenPoint = { code?: string; city?: string; fullAddress?: string; address?: string; coordX?: number; coordY?: number; workTime?: string };

function asPoints(rows: PointRow[]) {
  return rows.flatMap((row) => {
    const place = row.location;
    if (!row.code || !place || place.latitude == null || place.longitude == null) return [];
    const address = place.address_full || place.address;
    if (!address) return [];
    return [{ code: row.code, address, city: place.city ?? '', latitude: place.latitude, longitude: place.longitude, hours: row.work_time ?? '' }];
  });
}

async function openCatalog(cityCode: number) {
  const response = await fetch(`https://integration.cdek.ru/pvzlist/v1/json?cityid=${cityCode}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) return [];
  const json = await response.json() as { pvz?: OpenPoint[] };
  return (json.pvz ?? []).flatMap((row) => {
    const latitude = Number(row.coordY);
    const longitude = Number(row.coordX);
    const address = row.fullAddress || row.address;
    if (!row.code || !address || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
    return [{ code: row.code, address, city: row.city ?? '', latitude, longitude, hours: row.workTime ?? '' }];
  });
}

export async function findPoints(cityCode: number): Promise<{ ok: true; points: CdekPoint[] } | { ok: false; message: string }> {
  if (!Number.isInteger(cityCode) || cityCode <= 0) return { ok: false, message: 'Выберите город из списка.' };
  try {
    const [fromApi, fromOpen] = await Promise.all([
      call<PointRow[]>(`/deliverypoints?city_code=${cityCode}&type=PVZ`).then(asPoints).catch(() => [] as CdekPoint[]),
      openCatalog(cityCode).catch(() => [] as CdekPoint[]),
    ]);
    const points = fromOpen.length > fromApi.length ? fromOpen : fromApi;
    if (!points.length) return { ok: false, message: 'В этом городе пунктов СДЭК не нашлось.' };
    return { ok: true, points };
  } catch (error) {
    return { ok: false, message: fail(error) };
  }
}

export async function quotePvz(cityCode: number, pointCode: string, packages: CdekPackage[]) {
  if (!/^[\w-]{2,32}$/.test(pointCode)) return { ok: false as const, message: 'Выберите пункт выдачи на карте.' };
  if (!packages.length || packages.some((item) => item.weight < 1 || item.length < 1 || item.width < 1 || item.height < 1)) {
    return { ok: false as const, message: 'Для расчёта нужны вес и три размера каждого товара.' };
  }
  try {
    const points = await findPoints(cityCode);
    if (!points.ok) return points;
    const point = points.points.find((item) => item.code === pointCode);
    if (!point) return { ok: false as const, message: 'Этот пункт не относится к выбранному городу.' };
    const from = await originCityCode();
    const result = await call<{ tariff_codes?: Tariff[] }>('/calculator/tarifflist', {
      method: 'POST',
      body: JSON.stringify({ type: 1, from_location: { code: from }, to_location: { code: cityCode }, packages }),
    });
    const tariffs = (result.tariff_codes ?? []).filter((item) => item.delivery_sum != null && item.delivery_mode === 4 && item.tariff_code);
    const chosen = tariffs.find((item) => item.tariff_code === 136) ?? [...tariffs].sort((a, b) => (a.delivery_sum ?? 0) - (b.delivery_sum ?? 0))[0];
    if (!chosen || chosen.delivery_sum == null || !chosen.tariff_code) return { ok: false as const, message: 'СДЭК не посчитал доставку склад — склад до этого пункта.' };
    const amount = money(chosen.delivery_sum);
    const period = chosen.period_min && chosen.period_max ? `${chosen.period_min}–${chosen.period_max} дн.` : '';
    const tariffName = chosen.tariff_name?.trim() || `Тариф ${chosen.tariff_code}`;
    const label = ['СДЭК', point.city, point.address, point.code, tariffName, period && `срок ${period}`, `доставка ${amount} ₽`].filter(Boolean).join(', ');
    return {
      ok: true as const, amount, period, tariffCode: chosen.tariff_code, tariffName, label,
      address: `${point.city}, ${point.address}`, code: point.code, study: session?.study === true,
    };
  } catch (error) {
    return { ok: false as const, message: fail(error) };
  }
}

export type CdekPlace = { name: string; wareKey: string; cost: number; weight: number; length: number; width: number; height: number };

function timedOut(error: unknown) {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

function problemText(json: unknown) {
  const bag = json as { message?: string; errors?: { message?: string }[]; requests?: { errors?: { message?: string }[] }[] };
  const nested = bag?.requests?.flatMap((item) => item.errors ?? []) ?? [];
  const message = bag?.errors?.[0]?.message || nested[0]?.message || bag?.message || '';
  return String(message).replace(/\s+/g, ' ').slice(0, 240);
}

async function authorized(path: string, init?: RequestInit) {
  const current = await connect();
  try {
    const response = await fetch(current.base + path, {
      ...init,
      headers: {
        authorization: `Bearer ${current.value}`,
        accept: 'application/json',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
      },
      signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: response.status, json };
  } catch (error) {
    if (timedOut(error)) return { status: 0, json: null, timeout: true as const };
    throw error;
  }
}

function readEntity(json: unknown) {
  const bag = json as { entity?: { uuid?: string; cdek_number?: string; number?: string } };
  const entity = bag?.entity;
  if (!entity?.uuid) return null;
  return { uuid: entity.uuid, cdekNumber: entity.cdek_number?.trim() || null };
}

export async function findShopShipment(shopNumber: string): Promise<
  { ok: true; found: false } | { ok: true; found: true; uuid: string; cdekNumber: string | null } | { ok: false; timeout?: boolean; message: string }
> {
  try {
    const response = await authorized(`/orders?im_number=${encodeURIComponent(shopNumber)}`);
    if ('timeout' in response && response.timeout) return { ok: false, timeout: true, message: 'СДЭК не ответил вовремя.' };
    if (response.status === 404 || response.status === 400 || response.status === 200) {
      const found = readEntity(response.json);
      if (found) return { ok: true, found: true, ...found };
      return { ok: true, found: false };
    }
    return { ok: false, message: problemText(response.json) || 'СДЭК не подтвердил, есть ли уже такое отправление.' };
  } catch (error) {
    return { ok: false, message: fail(error) };
  }
}

export async function registerShipment(input: {
  number: string; tariffCode: number; deliveryPoint: string; recipientName: string; phone: string; email: string | null; places: CdekPlace[];
}): Promise<{ ok: true; uuid: string; cdekNumber: string | null } | { ok: false; timeout?: boolean; message: string }> {
  if (!input.places.length) return { ok: false, message: 'Для отправления нужны вес и размеры.' };
  const body = {
    type: 1,
    number: input.number,
    tariff_code: input.tariffCode,
    shipment_point: cdekShipmentPoint,
    delivery_point: input.deliveryPoint,
    recipient: {
      name: input.recipientName,
      phones: [{ number: input.phone }],
      ...(input.email ? { email: input.email } : {}),
    },
    packages: input.places.map((place, index) => ({
      number: String(index + 1),
      weight: place.weight,
      length: place.length,
      width: place.width,
      height: place.height,
      items: [{
        name: place.name.slice(0, 255),
        ware_key: (place.wareKey || String(index + 1)).slice(0, 50),
        payment: { value: 0 },
        cost: place.cost,
        weight: place.weight,
        amount: 1,
      }],
    })),
  };
  try {
    const response = await authorized('/orders', { method: 'POST', body: JSON.stringify(body) });
    if ('timeout' in response && response.timeout) return { ok: false, timeout: true, message: 'СДЭК не ответил вовремя.' };
    const created = readEntity(response.json);
    if ((response.status === 200 || response.status === 202) && created) {
      if (created.cdekNumber) return { ok: true, ...created };
      const again = await authorized(`/orders/${encodeURIComponent(created.uuid)}`);
      const fresh = !('timeout' in again) ? readEntity(again.json) : null;
      return { ok: true, uuid: created.uuid, cdekNumber: fresh?.cdekNumber ?? null };
    }
    return { ok: false, message: problemText(response.json) || 'СДЭК не принял отправление.' };
  } catch (error) {
    if (timedOut(error)) return { ok: false, timeout: true, message: 'СДЭК не ответил вовремя.' };
    return { ok: false, message: fail(error) };
  }
}
