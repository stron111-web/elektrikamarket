import 'server-only';

const liveApi = 'https://api.cdek.ru/v2';
const studyApi = 'https://api.edu.cdek.ru/v2';
const studyAccount = 'wqGwiQx0gg8mLtiEKsUinjVSICCjtTEP';
const studySecret = 'RmAmgvSgSl1yirlz9QupbzOJVqhCxcP5';

type CityRow = { code?: number; city?: string; region?: string; latitude?: number; longitude?: number };
type PointRow = { code?: string; location?: { address?: string; address_full?: string; city?: string; latitude?: number; longitude?: number }; work_time?: string };
type Tariff = { tariff_code?: number; delivery_mode?: number; delivery_sum?: number; period_min?: number; period_max?: number };

export type CdekCity = { code: number; city: string; region: string; latitude: number; longitude: number };
export type CdekPoint = { code: string; address: string; city: string; latitude: number; longitude: number; hours: string };
export type CdekPackage = { weight: number; length: number; width: number; height: number };

let session: { value: string; until: number; base: string; study: boolean } | null = null;
let liveRejected = false;
let fromCity: number | null = null;

function keys() {
  const id = process.env.CDEK_ACCOUNT?.trim();
  const secret = process.env.CDEK_SECURE_PASSWORD?.trim();
  if (!id || !secret) return null;
  return { id, secret };
}

function fail(error: unknown) {
  if (error instanceof Error && error.message === 'offline') return 'СДЭК на этом запуске сайта не подключён.';
  if (error instanceof Error && error.message === 'auth') return 'СДЭК не принял ключ. Новый ключ создавать не нужно.';
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
  if (pair && !liveRejected) {
    try {
      const live = await login(liveApi, pair.id, pair.secret);
      session = { ...live, study: false };
      return session;
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'auth') throw error;
      liveRejected = true;
      fromCity = null;
    }
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

async function tolyatti() {
  if (fromCity) return fromCity;
  const rows = await call<CityRow[]>(`/location/cities?country_codes=RU&city=${encodeURIComponent('Тольятти')}&size=20`);
  const found = rows.find((row) => row.code && /самар/i.test(row.region ?? '')) ?? rows.find((row) => row.code && row.city === 'Тольятти');
  if (!found?.code) throw new Error('from');
  fromCity = found.code;
  return found.code;
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
    const from = await tolyatti();
    const result = await call<{ tariff_codes?: Tariff[] }>('/calculator/tarifflist', {
      method: 'POST',
      body: JSON.stringify({ type: 1, from_location: { code: from }, to_location: { code: cityCode }, packages }),
    });
    const tariffs = (result.tariff_codes ?? []).filter((item) => item.delivery_sum != null && (item.delivery_mode === 4 || item.delivery_mode === 2));
    const chosen = tariffs.find((item) => item.tariff_code === 136) ?? [...tariffs].sort((a, b) => (a.delivery_sum ?? 0) - (b.delivery_sum ?? 0))[0];
    if (!chosen || chosen.delivery_sum == null) return { ok: false as const, message: 'СДЭК не посчитал доставку до этого пункта.' };
    const amount = money(chosen.delivery_sum);
    const period = chosen.period_min && chosen.period_max ? `${chosen.period_min}–${chosen.period_max} дн.` : '';
    const label = ['СДЭК', point.city, point.address, point.code, period && `срок ${period}`, `доставка ${amount} ₽`].filter(Boolean).join(', ');
    return { ok: true as const, amount, period, label, address: `${point.city}, ${point.address}`, code: point.code, study: session?.study === true };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error && error.message === 'from' ? 'СДЭК не нашёл город отправления Тольятти.' : fail(error) };
  }
}
