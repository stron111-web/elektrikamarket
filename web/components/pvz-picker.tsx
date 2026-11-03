'use client';

import { useEffect, useRef, useState } from 'react';
import { loadCity, loadPoints, pricePoint, rememberDelivery, searchCities } from '../lib/delivery-actions';
import { money } from '../lib/format';

type CdekCity = { code: number; city: string; region: string; latitude: number; longitude: number };
type CdekPoint = { code: string; address: string; city: string; latitude: number; longitude: number; hours: string };

type YMap = { addChild: (child: unknown) => void; destroy: () => void };
type YMaps = {
  ready: Promise<void>;
  YMap: new (element: HTMLElement, props: { location: { center: [number, number]; zoom: number } }) => YMap;
  YMapDefaultSchemeLayer: new () => unknown;
  YMapDefaultFeaturesLayer: new () => unknown;
  YMapMarker: new (props: { coordinates: [number, number] }, element: HTMLElement) => unknown;
};

declare global {
  interface Window { ymaps3?: YMaps }
}

export function PvzPicker({ mapKey, goods, initialCity, savedPoint, signedIn }: {
  mapKey: string; goods: string; initialCity: string; savedPoint: string; signedIn: boolean;
}) {
  const [query, setQuery] = useState(initialCity);
  const [cities, setCities] = useState<CdekCity[]>([]);
  const [city, setCity] = useState<CdekCity | null>(null);
  const [points, setPoints] = useState<CdekPoint[]>([]);
  const [chosen, setChosen] = useState<CdekPoint | null>(null);
  const [pinCode, setPinCode] = useState(savedPoint);
  const [notice, setNotice] = useState('');
  const [study, setStudy] = useState(false);
  const [price, setPrice] = useState('');
  const [period, setPeriod] = useState('');
  const [total, setTotal] = useState('');
  const [busy, setBusy] = useState(false);
  const mapHost = useRef<HTMLDivElement>(null);
  const chooseRef = useRef<(point: CdekPoint) => void>(() => {});

  useEffect(() => {
    const name = initialCity.trim();
    if (name.length < 2) return;
    let dead = false;
    void searchCities(name).then((result) => {
      if (dead || !result.ok) return;
      setStudy(result.study);
      const exact = result.cities.find((item) => item.city.toLowerCase() === name.toLowerCase());
      if (exact) void openCity(exact);
    });
    return () => { dead = true; };
  }, [initialCity]);

  useEffect(() => {
    const name = query.trim();
    if (name.length < 2) {
      setCities([]);
      return;
    }
    if (city && city.city.toLowerCase() === name.toLowerCase()) {
      setCities([]);
      return;
    }
    let dead = false;
    const timer = setTimeout(() => {
      void searchCities(name).then((result) => {
        if (dead) return;
        if (!result.ok) {
          setCities([]);
          setNotice(result.message);
          return;
        }
        setNotice('');
        setStudy(result.study);
        setCities(result.cities);
      });
    }, 250);
    return () => {
      dead = true;
      clearTimeout(timer);
    };
  }, [query, city]);

  async function openCity(next: CdekCity) {
    setBusy(true);
    setQuery(next.city);
    setCities([]);
    const place = next.latitude && next.longitude ? next : await loadCity(next.code) ?? next;
    if (!place.latitude || !place.longitude) {
      setBusy(false);
      setNotice('СДЭК не отдал координаты этого города.');
      return;
    }
    setCity(place);
    setChosen(null);
    setPrice('');
    setPeriod('');
    setTotal('');
    setCities([]);
    if (signedIn) void rememberDelivery({ city: next.city, cityCode: next.code });
    const result = await loadPoints(next.code);
    setBusy(false);
    if (!result.ok) {
      setPoints([]);
      setNotice(result.message);
      return;
    }
    setPoints(result.points);
    setNotice('');
  }

  async function choose(point: CdekPoint) {
    setChosen(point);
    setPinCode('');
    if (signedIn && city) void rememberDelivery({ city: city.city, cityCode: city.code, pointCode: point.code, pointAddress: `${point.city}, ${point.address}` });
    setBusy(true);
    const result = city ? await pricePoint(city.code, point.code) : { ok: false as const, message: 'Сначала выберите город.' };
    setBusy(false);
    if (!result.ok) {
      setPrice('');
      setTotal('');
      setNotice(result.message);
      return;
    }
    setPrice(result.amount);
    setPeriod(result.period);
    setTotal(result.total);
    setNotice('');
  }
  chooseRef.current = choose;

  useEffect(() => {
    if (!pinCode || chosen || !points.length) return;
    const point = points.find((item) => item.code === pinCode);
    if (point) void chooseRef.current(point);
  }, [points, pinCode, chosen]);

  useEffect(() => {
    const host = mapHost.current;
    if (!host || !mapKey || !city) return;
    let map: YMap | null = null;
    let dead = false;
    const pins = new Map<string, HTMLButtonElement>();
    void (async () => {
      const maps = await loadMaps(mapKey);
      if (dead || !maps) {
        if (!dead) setNotice('Карта Яндекса не открылась. Пункты ниже можно выбрать списком. Для карты на этом компьютере в ключе нужен адрес 127.0.0.1.');
        return;
      }
      await maps.ready;
      if (dead) return;
      host.replaceChildren();
      map = new maps.YMap(host, { location: { center: [city.longitude, city.latitude], zoom: 12 } });
      map.addChild(new maps.YMapDefaultSchemeLayer());
      map.addChild(new maps.YMapDefaultFeaturesLayer());
      for (const point of points) {
        const pin = document.createElement('button');
        pin.type = 'button';
        pin.className = 'pvz-pin';
        pin.dataset.code = point.code;
        pin.title = point.address;
        pin.addEventListener('click', () => chooseRef.current(point));
        pins.set(point.code, pin);
        map.addChild(new maps.YMapMarker({ coordinates: [point.longitude, point.latitude] }, pin));
      }
    })();
    return () => {
      dead = true;
      map?.destroy();
      host.replaceChildren();
    };
  }, [mapKey, city, points]);

  useEffect(() => {
    const host = mapHost.current;
    if (!host) return;
    for (const pin of host.querySelectorAll<HTMLButtonElement>('.pvz-pin')) {
      pin.classList.toggle('selected', pin.dataset.code === chosen?.code);
    }
  }, [chosen]);

  const address = chosen ? `${chosen.city}, ${chosen.address}` : '';
  return (
    <div className="pvz-box">
      <p className="pvz-hint">{signedIn ? 'Город уже подставлен, карта откроется сама. Другой город можно вписать вместо этого.' : 'Как только вы введёте город, откроется карта с пунктами СДЭК в этом городе.'}</p>
      <div className="pvz-field">
        <label>Город *
          <input value={query} onChange={(event) => { setQuery(event.target.value); setPinCode(''); setCity(null); setPoints([]); setChosen(null); setPrice(''); }} placeholder="Начните вводить, например То" autoComplete="off" />
        </label>
        {cities.length ? (
          <div className="pvz-cities">
            {cities.map((item) => (
              <button type="button" key={item.code} onClick={() => void openCity(item)}>{item.city}{item.region ? `, ${item.region}` : ''}</button>
            ))}
          </div>
        ) : null}
      </div>
      {study ? <p className="account-notice">Ключ кабинета СДЭК со снимка не подошёл, поэтому на карте учебные пункты. Новый ключ создавать не нужно.</p> : null}
      {city && points.length ? <p className="pvz-hint">Пункты СДЭК: {city.city}. Выберите точку на карте или в списке.</p> : null}
      {city && mapKey ? <div className="pvz-map" ref={mapHost} /> : null}
      {points.length ? (
        <div className="pvz-list">
          {points.map((point) => (
            <button type="button" key={point.code} className={chosen?.code === point.code ? 'selected' : ''} onClick={() => void choose(point)}>
              {point.address}{point.hours ? ` · ${point.hours}` : ''}
            </button>
          ))}
        </div>
      ) : null}
      {chosen && price ? <p>Доставка {money(price)}{period ? `, срок ${period}` : ''}. К оплате {money(total)}, из них товары {money(goods)}.</p> : null}
      {busy ? <p className="account-notice">Считаем пункты и доставку…</p> : null}
      {notice ? <p className="account-notice">{notice}</p> : null}
      <input type="hidden" name="carrier" value={chosen ? 'СДЭК' : ''} />
      <input type="hidden" name="deliveryPoint" value={address} />
      <input type="hidden" name="cdekCity" value={city?.code ?? ''} />
      <input type="hidden" name="cdekPoint" value={chosen?.code ?? ''} />
    </div>
  );
}

function loadMaps(key: string) {
  if (window.ymaps3) return Promise.resolve(window.ymaps3);
  const id = 'yandex-maps-v3';
  const previous = document.getElementById(id) as HTMLScriptElement | null;
  const wait = (script: HTMLScriptElement) => new Promise<YMaps | null>((resolve) => {
    script.addEventListener('load', () => resolve(window.ymaps3 ?? null), { once: true });
    script.addEventListener('error', () => resolve(null), { once: true });
  });
  if (previous) return wait(previous);
  const script = document.createElement('script');
  script.id = id;
  script.src = `https://api-maps.yandex.ru/v3/?apikey=${encodeURIComponent(key)}&lang=ru_RU`;
  script.async = true;
  document.head.appendChild(script);
  return wait(script);
}
