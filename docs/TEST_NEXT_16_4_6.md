# Test: Next.js 16.4.6

База: `d456803`, без изменений прикладной логики. `web/package.json` фиксирует
`next=16.4.6`; штатный npm обновляет lock только для Next, `@next/env` и SWC.
React/React DOM остаются 19.3.0. Node 24 поддерживается (`>=20.9.0`).

## Безопасность, 20.11.2026

Проверены [официальные advisories](https://github.com/vercel/next.js/security/advisories),
[16.4.5](https://github.com/vercel/next.js/releases/tag/v16.4.5),
[16.4.6](https://github.com/vercel/next.js/releases/tag/v16.4.6) и npm latest=16.4.6.
Аудит до: один уязвимый production-пакет Next с десятью advisories;
после: 0 уязвимостей для полного web-дерева и production-only.

Исправления 16.4.1: GHSA-2464-fhr4-w9xw (SVG/Image Optimization RCE),
GHSA-673q-mjm6-r5xr (`use cache` typed arrays RCE), GHSA-p3m5-59mp-jv5r
(Server Actions DoS). Исправления 16.4.5, включённые в 16.4.6:
GHSA-mfr8-8qww-v76h, GHSA-vc7v-qv4w-wrv8, GHSA-7qx7-33qx-rqx2,
GHSA-f3mh-rxg3-f5g2, GHSA-pc58-hwjq-p385, GHSA-rhh4-g77r-r9qj,
GHSA-vvgp-ww4w-46vf (cache disclosure/poisoning, response injection,
SVG rejection bypass, HttpOnly exposure). Нулевой audit не гарантирует
отсутствия неизвестных уязвимостей; применимость отдельных атак зависит от функций приложения.

## Проверки и установка

`npm ci --ignore-scripts`, TypeScript, production build и 14 коротких тестов
search-model/filters/etim. Образ собирается из этого commit штатным Dockerfile,
проверяется отдельным web-контейнером с существующим read-only доступом, без новой БД.
Затем только Test `web`, через существующий deploy lock и immutable image pin:
Compose `up -d --no-deps --pull never --wait --wait-timeout 180 web`.

Предыдущий image и release.env/Compose сохраняются перед заменой. При сбое
возвращается прежний web image; БД, права, Caddy и остальные службы не меняются.
Фактические журналы, HTTPS-проверки, runtime-версия и rollback path:
`outputs/test-next-20261120/` в рабочей среде (вне исходников релиза).
