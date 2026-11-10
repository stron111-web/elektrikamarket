'use client';

import { useEffect, useRef, useState } from 'react';
import { loadAllPoints, loadCity, loadPoints, loadGroupedPoints, pricePoint, rememberDelivery, searchCities } from '../lib/delivery-actions';
import { money } from '../lib/format';
import { yandexPublicKey } from '../lib/yandex-public-key';

type CdekCity = { code: number; city: string; region: string; latitude: number; longitude: number };
type CdekPoint = { code: string; address: string; city: string; latitude: number; longitude: number; hours: string; cityCode?: number };

type CdekBounds = [[number, number], [number, number]];
type YMap = {
  addChild: (child: unknown) => void;
  removeChild: (child: unknown) => void;
  bounds: CdekBounds;
  destroy: () => void;
  update: (props: { location: { center: [number, number]; zoom: number; duration?: number } }) => void;
};
type MapFeature = {
  type: 'Feature';
  id: string;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: { point: CdekPoint };
};
type YMaps = {
  ready: Promise<void>;
  import: (name: string) => Promise<{
    YMapClusterer: new (props: {
      method: unknown;
      features: MapFeature[];
      marker: (feature: MapFeature) => unknown;
      cluster: (coordinates: [number, number], features: MapFeature[]) => unknown;
    }) => unknown;
    clusterByGrid: (options: { gridSize: number }) => unknown;
  }>;
  YMap: new (element: HTMLElement, props: { location: { center: [number, number]; zoom: number } }) => YMap;
  YMapDefaultSchemeLayer: new () => unknown;
  YMapDefaultFeaturesLayer: new () => unknown;
  YMapListener: new (props: { onUpdate: (event: { location: { bounds: CdekBounds; zoom: number }; mapInAction: boolean }) => void }) => unknown;
  YMapMarker: new (props: { coordinates: [number, number] }, element: HTMLElement) => unknown;
};

declare global {
  interface Window { ymaps3?: YMaps }
}

export function PvzPicker({ mapKey, goods, initialCity, savedPoint, signedIn }: {
  mapKey: string; goods: string; initialCity: string; savedPoint: string; signedIn: boolean;
}) {
  const yandexKey = mapKey || yandexPublicKey;
  const [query, setQuery] = useState(initialCity);
  const [cities, setCities] = useState<CdekCity[]>([]);
  const [city, setCity] = useState<CdekCity | null>(null);
  const [points, setPoints] = useState<CdekPoint[]>([]);
  const [countryPoints, setCountryPoints] = useState<CdekPoint[] | null>(null);
  const [chosen, setChosen] = useState<CdekPoint | null>(null);
  const [pinCode, setPinCode] = useState(savedPoint);
  const [notice, setNotice] = useState('');
  const [study, setStudy] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [price, setPrice] = useState('');
  const [period, setPeriod] = useState('');
  const [tariff, setTariff] = useState('');
  const [total, setTotal] = useState('');
  const [busy, setBusy] = useState(false);
  const [listOpen, setListOpen] = useState(true);
  const mapHost = useRef<HTMLDivElement>(null);
  const lockedRef = useRef<HTMLLabelElement>(null);
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
    const { cityPart, street } = splitPlace(query);
    if (cityPart.length < 2) {
      setCities([]);
      return;
    }
    if (city && cityPart.toLowerCase() === city.city.toLowerCase()) {
      setCities([]);
      return;
    }
    let dead = false;
    const timer = setTimeout(() => {
      void searchCities(cityPart).then((result) => {
        if (dead) return;
        if (!result.ok) {
          setCities([]);
          setNotice(result.message);
          return;
        }
        setNotice('');
        setStudy(result.study);
        const exact = result.cities.find((item) => item.city.toLowerCase() === cityPart.toLowerCase());
        if (exact && street) void openCity(exact, street);
        else setCities(result.cities);
      });
    }, 250);
    return () => {
      dead = true;
      clearTimeout(timer);
    };
  }, [query, city]);

  async function openCity(next: CdekCity, street = '') {
    setBusy(true);
    setQuery(street ? `${next.city}, ${street}` : next.city);
    setShowMap(false);
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
    setTariff('');
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
    const code = point.cityCode ?? city?.code;
    if (!code) {
      setNotice('Не удалось определить город выбранного пункта СДЭК.');
      return;
    }
    const place = city?.code === code
      ? city
      : await loadCity(code) ??
        { code, city: point.city, region: '', latitude: point.latitude, longitude: point.longitude };
    setChosen(point);
    setListOpen(false);
    setPinCode('');
    setNotice('');
    if (!city || city.code !== place.code) {
      setCity(place);
      setQuery(place.city);
      const newList = await loadPoints(place.code);
      if (newList.ok) setPoints(newList.points);
    }
    setTimeout(() => lockedRef.current?.scrollIntoView({ block: 'center' }), 60);
    if (signedIn && place) void rememberDelivery({ city: place.city, cityCode: place.code, pointCode: point.code, pointAddress: `${point.city}, ${point.address}` });
    setBusy(true);
    try {
      const result = place ? await pricePoint(place.code, point.code) : { ok: false as const, message: 'Сначала выберите город.' };
      if (!result.ok) {
        setPrice('');
        setTotal('');
        setTariff('');
        setNotice(result.message);
        return;
      }
      setPrice(result.amount);
      setPeriod(result.period);
      setTariff(result.tariffName);
      setTotal(result.total);
      setNotice('');
    } catch {
      setPrice('');
      setTotal('');
      setTariff('');
      setNotice('Пункт выбран. Сумму доставки сейчас посчитать не удалось.');
    } finally {
      setBusy(false);
    }
  }
  chooseRef.current = choose;

  useEffect(() => {
    if (!pinCode || chosen || !points.length) return;
    const point = points.find((item) => item.code === pinCode);
    if (point) void chooseRef.current(point);
  }, [points, pinCode, chosen]);

  useEffect(() => {
    if (!showMap || city || countryPoints) return;
    let dead = false;
    setBusy(true);
    setNotice('Открываем все пункты СДЭК на карте…');
    void loadAllPoints().then((result) => {
      if (dead) return;
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      setCountryPoints(result.points);
      setNotice('');
    }).finally(() => {
      if (!dead) setBusy(false);
    });
    return () => { dead = true; };
  }, [showMap, city, countryPoints]);

  useEffect(() => {
    const host = mapHost.current;
    if (!host || !showMap) return;
    let dead = false;
    let yandex: YMap | null = null;
    const shown = city ? shownPoints(points, query, city.city) : (countryPoints ?? []);
    const center: [number, number] = city ? [city.longitude, city.latitude] : [50.1, 55.0];
    const zoom = city ? 12 : 4;
    void (async () => {
      if (!yandexKey) {
        setNotice('Яндекс Карта на этом запуске не подключена. Пункт можно выбрать в списке.');
        return;
      }
      const maps = await loadMaps(yandexKey);
      if (dead) return;
      if (!maps) {
        setNotice('Яндекс Карта не открылась. Пункт можно выбрать в списке.');
        return;
      }
      await maps.ready;
      if (dead) return;
      host.replaceChildren();
      yandex = new maps.YMap(host, { location: { center, zoom } });
      yandex.addChild(new maps.YMapDefaultSchemeLayer());
      yandex.addChild(new maps.YMapDefaultFeaturesLayer());
      if (!city && shown.length) {
        const { YMapClusterer, clusterByGrid } = await maps.import('@yandex/ymaps3-clusterer');
        if (dead || !yandex) return;
        const features: MapFeature[] = shown.map((point) => ({
          type: 'Feature',
          id: point.code,
          geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
          properties: { point },
        }));
        yandex.addChild(new YMapClusterer({
          method: clusterByGrid({ gridSize: 64 }),
          features,
          marker: (feature) => {
            const point = feature.properties.point;
            const pin = document.createElement('button');
            pin.type = 'button';
            pin.className = 'pvz-pin';
            pin.dataset.code = point.code;
            pin.title = point.address;
            pin.addEventListener('click', () => chooseRef.current(point));
            return new maps.YMapMarker({ coordinates: feature.geometry.coordinates }, pin);
          },
          cluster: (coordinates, group) => {
            const badge = document.createElement('button');
            badge.type = 'button';
            badge.className = 'pvz-cluster';
            badge.textContent = String(group.length);
            badge.addEventListener('click', () => yandex?.update({ location: { center: coordinates, zoom: 11, duration: 200 } }));
            return new maps.YMapMarker({ coordinates }, badge);
          },
        }));
        return;
      }
      const originalMarkers: unknown[] = [];
      for (const point of shown) {
        const pin = document.createElement('button');
        pin.type = 'button';
        pin.className = 'pvz-pin';
        pin.dataset.code = point.code;
        pin.title = point.address;
        pin.addEventListener('click', () => chooseRef.current(point));
        const marker = new maps.YMapMarker({ coordinates: [point.longitude, point.latitude] }, pin);
        yandex.addChild(marker);
        originalMarkers.push(marker);
      }

      // Server aggregates every visible point BEFORE limiting output, so
      // distant towns still appear when zooming out across a large region.
      // Original city pins are retained as a fallback if the API fails.
      if (city && !streetOf(query, city.city)) {
        const activeMap = yandex;
        const Marker = maps.YMapMarker;
        let extraMarkers: unknown[] = [];
        let localMarkersVisible = true;
        let debounce: ReturnType<typeof setTimeout> | null = null;
        let requestIndex = 0;
        let requestedKey = '';
        let latestZoom = zoom;
        const localCityCode = city.code;

        function request(bounds: CdekBounds, currentZoom: number) {
          if (dead || !Array.isArray(bounds) || bounds.length !== 2 ||
              !Number.isFinite(currentZoom)) return;
          latestZoom = currentZoom;
          const precision = currentZoom >= 13 ? 5 : currentZoom >= 10 ? 3 : 2;
          const key = currentZoom.toFixed(1) + ':' +
            bounds.flat().map((v) => Number(v).toFixed(precision)).join(',');
          if (key === requestedKey) return;
          requestedKey = key;
          const sequence = ++requestIndex;
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(() => {
            void loadGroupedPoints(bounds, currentZoom, localCityCode).then((result) => {
              if (dead || sequence !== requestIndex) return;
              if (!result.ok) {
                requestedKey = '';
                setNotice('Не удалось обновить группы СДЭК. Пункты выбранного города доступны.');
                return;
              }
              const replacement: unknown[] = [];
              try {
                for (const node of result.nodes) {
                  const label = document.createElement('button');
                  label.type = 'button';
                  if (node.kind === 'cluster') {
                    label.className = 'pvz-cluster';
                    label.textContent = String(node.count);
                    label.title = `Пунктов выдачи: ${node.count}. Нажмите, чтобы приблизить.`;
                    label.addEventListener('click', () => {
                      activeMap.update({
                        location: {
                          center: [node.longitude, node.latitude],
                          zoom: Math.min(20, latestZoom + 2),
                          duration: 200,
                        },
                      });
                    });
                    const marker = new Marker({ coordinates: [node.longitude, node.latitude] }, label);
                    activeMap.addChild(marker);
                    replacement.push(marker);
                  } else {
                    const point = node.point;
                    label.className = 'pvz-pin';
                    label.dataset.code = point.code;
                    label.title = fullAddress(point);
                    label.addEventListener('click', () => chooseRef.current(point));
                    const marker = new Marker({ coordinates: [point.longitude, point.latitude] }, label);
                    activeMap.addChild(marker);
                    replacement.push(marker);
                  }
                }
              } catch {
                for (const marker of replacement) activeMap.removeChild(marker);
                requestedKey = '';
                setNotice('Не удалось нарисовать группы СДЭК. Пункты выбранного города доступны.');
                return;
              }

              // Replace only the optional overlay; preserve the original pins
              // until server data is sufficient to cover the selected city.
              for (const marker of extraMarkers) activeMap.removeChild(marker);
              extraMarkers = replacement;
              const showLocal = currentZoom >= 15 || !result.hasSelectedCity ||
                !result.nodes.length || result.truncated;
              if (showLocal && !localMarkersVisible) {
                for (const marker of originalMarkers) activeMap.addChild(marker);
                localMarkersVisible = true;
              } else if (!showLocal && localMarkersVisible) {
                for (const marker of originalMarkers) activeMap.removeChild(marker);
                localMarkersVisible = false;
              }
              setNotice(result.truncated
                ? 'На карте слишком много групп. Приблизьте карту, чтобы увидеть остальные.'
                : '');
            }).catch(() => {
              if (dead || sequence !== requestIndex) return;
              requestedKey = '';
              setNotice('Соседние пункты временно недоступны. Пункты выбранного города работают.');
            });
          }, 450);
        }

        try {
          activeMap.addChild(new maps.YMapListener({
            onUpdate: ({ location, mapInAction }) => {
              if (!mapInAction) request(location.bounds, location.zoom);
            },
          }));
          request(activeMap.bounds, zoom);
        } catch {
          // SDK listener errors must never affect the original city pins.
        }
      }
    })();
    return () => {
      dead = true;
      yandex?.destroy();
      host.replaceChildren();
    };
  }, [showMap, yandexKey, city, points, query, countryPoints]);

  useEffect(() => {
    const host = mapHost.current;
    if (!host) return;
    for (const pin of host.querySelectorAll<HTMLButtonElement>('.pvz-pin')) {
      pin.classList.toggle('selected', pin.dataset.code === chosen?.code);
    }
  }, [chosen]);

  function editQuery(value: string) {
    setQuery(value);
    setPinCode('');
    const selected = city?.city.toLowerCase() ?? '';
    const typed = value.trim().toLowerCase();
    const same = Boolean(selected) && (typed === selected || typed.startsWith(`${selected},`) || typed.startsWith(`${selected} `));
    if (same) {
      setCities([]);
      return;
    }
    setCity(null);
    setPoints([]);
    setChosen(null);
    setPrice('');
    setPeriod('');
    setTariff('');
    setShowMap(false);
  }

  const address = chosen ? fullAddress(chosen) : '';
  const street = city ? streetOf(query, city.city) : '';
  const visible = shownPoints(points, query, city?.city ?? '');
  return (
    <div className="pvz-box">
      <p className="pvz-hint">{signedIn ? 'Город уже подставлен. Другой можно вписать вместо него. После запятой пишите улицу.' : 'Напишите город. После запятой можно указать улицу, список сузится.'}</p>
      <div className="pvz-field">
        <label>Город *
          <input value={query} onChange={(event) => editQuery(event.target.value)} placeholder="Тольятти, улица" autoComplete="off" />
        </label>
        {cities.length ? (
          <div className="pvz-cities">
            {cities.map((item) => (
              <button type="button" key={item.code} onClick={() => void openCity(item)}>{item.city}{item.region ? `, ${item.region}` : ''}</button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="pvz-actions">
        <button type="button" className="pvz-map-button" onClick={() => setShowMap((open) => !open)}>{showMap ? 'Скрыть карту' : 'Выбрать на карте'}</button>
        <button type="button" className="pvz-disclosure" aria-expanded={listOpen} onClick={() => setListOpen((open) => !open)}>
          <span>Пункт выдачи</span>
          <span className="pvz-caret" aria-hidden="true" />
          <span className="pvz-choose">(выбрать)</span>
        </button>
      </div>
      {showMap ? <div className="pvz-map" ref={mapHost} /> : null}
      {chosen ? (
        <label className="pvz-locked" ref={lockedRef}>
          <input readOnly value={address} aria-label="Выбранный пункт выдачи" />
        </label>
      ) : null}
      {listOpen && visible.length ? <PvzList points={visible} city={city?.city ?? ''} chosen={chosen?.code ?? ''} onChoose={(point) => void choose(point)} /> : null}
      {study ? <p className="account-notice">Сумму по договору СДЭК этот запуск не считает: ключ кабинета со снимка не подошёл. Новый ключ создавать не нужно.</p> : null}
      {city && points.length ? <p className="pvz-hint">{street ? `По «${street}»: ${visible.length} из ${points.length}.` : `Пункты СДЭК в городе ${city.city}: ${points.length}.`}</p> : null}
      {street && !visible.length ? <p className="account-notice">По этой улице пунктов нет. Сократите название или уберите его после запятой.</p> : null}
      {chosen && price ? (
        <p>
          <strong>Доставка</strong> <strong>{money(price)}</strong>
          {tariff ? `, ${tariff}` : ''}
          {period ? <>, срок <strong>{period}</strong></> : null}
          {'. К оплате '}
          <strong>{money(total)}</strong>
          {', из них товары '}
          <strong>{money(goods)}</strong>.
        </p>
      ) : null}
      {busy ? <p className="account-notice">Считаем пункты и доставку…</p> : null}
      {notice ? <p className="account-notice">{notice}</p> : null}
      <input type="hidden" name="carrier" value={chosen ? 'СДЭК' : ''} />
      <input type="hidden" name="deliveryPoint" value={address} />
      <input type="hidden" name="cdekCity" value={city?.code ?? ''} />
      <input type="hidden" name="cdekPoint" value={chosen?.code ?? ''} />
    </div>
  );
}

function PvzList({ points, city, chosen, onChoose }: {
  points: CdekPoint[]; city: string; chosen: string; onChoose: (point: CdekPoint) => void;
}) {
  return (
    <div className="pvz-list">
      {points.map((point) => (
        <button type="button" key={point.code} className={chosen === point.code ? 'selected' : ''} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onChoose(point); }}>
          <span>{streetLine(point.address, city || point.city)}</span>
          {point.hours ? <span className="pvz-hours">{point.hours}</span> : null}
        </button>
      ))}
    </div>
  );
}

function splitPlace(value: string) {
  const [cityPart, ...rest] = value.split(',');
  return { cityPart: cityPart.trim(), street: rest.join(',').trim() };
}

function streetLine(address: string, cityName: string) {
  const city = cityName.trim().toLowerCase().replace(/ё/g, 'е');
  const kept = address.split(',').map((part) => part.trim()).filter(Boolean).filter((part) => {
    if (/^\d{5,6}$/.test(part)) return false;
    const low = part.toLowerCase().replace(/ё/g, 'е');
    if (low === 'россия' || low === 'рф') return false;
    if (/(область|край|республика|округ|автономн)/.test(low)) return false;
    if (city && low === city) return false;
    return true;
  });
  return kept.join(', ') || address;
}

function fullAddress(point: CdekPoint) {
  const text = point.address.trim();
  if (!point.city || text.toLowerCase().includes(point.city.toLowerCase())) return text;
  return `${point.city}, ${text}`;
}

function streetOf(value: string, cityName: string) {
  const typed = value.trim();
  const name = cityName.trim();
  if (!typed.toLowerCase().startsWith(name.toLowerCase())) return '';
  return typed.slice(name.length).replace(/^[\s,]+/, '').trim();
}

function shownPoints(points: CdekPoint[], value: string, cityName: string) {
  const street = streetOf(value, cityName);
  const needle = street.toLowerCase().replace(/ё/g, 'е').replace(/^(улица|ул|проспект|пр-т|просп|переулок|пер|бульвар|б-р|шоссе|ш)\.?\s+/, '').trim();
  if (needle.length < 2) return points;
  return points.filter((point) => point.address.toLowerCase().replace(/ё/g, 'е').includes(needle));
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
  script.referrerPolicy = 'strict-origin';
  script.src = `https://api-maps.yandex.ru/v3/?apikey=${encodeURIComponent(key)}&lang=ru_RU`;
  script.async = true;
  document.head.appendChild(script);
  return wait(script);
}
