# Технический паспорт: архитектура

Срез исходников: **2f20c290bf1f0b0d0c129e9cf7228f8c77cc03a4**, ветка
`codex/storefront-docker`, база витрины — `feat/storefront-mvp`.
Дата паспорта: **2026-10-29**. Документация подготовлена отдельно от рабочего checkout.

## Как читать паспорт

- **КОД** — реализовано в указанном срезе, проверено чтением исходников/тестов.
- **ПРАВИЛО** — подтверждено спецификацией или явными решениями владельца; наличие правила не означает наличие UI.
- **ЭКСПЛУАТАЦИЯ** — факт из завершённого развёртывания 2026-10-29, а не новая проверка VPS при написании паспорта.
- **ПЛАН** — отсутствующая функциональность или предлагаемая работа; не обещание срока.
- **ВОПРОС** — требуется решение; нельзя самостоятельно превращать предположение в правило.

Навигация: [БД](DATABASE.md), [бизнес-правила](BUSINESS_RULES.md),
[импорт](IMPORTS.md), [разработка и эксплуатация](DEVELOPMENT.md),
[статус и вопросы](ROADMAP.md), [инструкции агентам](../AGENTS.md).

Фактическое поведение определяет код; бизнес-контракт — подтверждённые решения.
При расхождении документируем оба и согласуем изменение. Старые разделы
[спецификации](../elektrikamarket_import_spec.md) неоднородны по версии:
реестр расхождений находится в ROADMAP, а не исправляется молча.

## Назначение и границы

**КОД:** нормализованный каталог одного поставщика, пакетные импортёры PRODAT/PRICAT,
read-only витрина Next.js. Браузер не разбирает XML, сайт не обращается к XML на запрос.
Нет реализованного цикла покупки: корзины, заказов, оплаты, доставки, кабинета,
админки и пользовательских ролей магазина.

**КОД:** Prisma описывает схему и историю SQL-миграций. Runtime импортёров и витрины
использует `postgres` (postgres.js), а не Prisma Client.
`prisma7.config.ts` — фактическое нестандартное имя конфигурации, не
`prisma.config.ts`; для Prisma CLI при необходимости указывать
`--config prisma7.config.ts`. Это не разрешение запускать миграции.

## Поток данных

```mermaid
flowchart TD
  P["PRODAT: все части локального набора"] --> Parser["Потоковый XML/ZIP parser"]
  R1["PRICAT1: локальный XML/ZIP"] --> Parser
  R2["PRICAT2: локальный XML/ZIP"] --> Parser
  Parser --> N["Нормализация, SHA, дедупликация, валидация"]
  N --> W["Writer: отдельная разрешённая операция"]
  W --> Catalog["Каталог, ссылки, аудит"]
  W --> Commercial["Коммерческие данные, цены, три склада"]
  Catalog --> PG[("PostgreSQL 17")]
  Commercial --> PG
  PG --> Rules["pricat-store.cjs: цена и доступность с карантином"]
  Rules --> Web["Next.js server components / read-only SQL"]
  Web --> Browser["HTML каталога и карточек"]
```

FTP discovery/download, расписание и отдельный постоянно работающий Import Worker —
**ПЛАН**, их нет в развёрнутом Compose. Не путать импортный CLI с автоматической загрузкой.

## Структура репозитория

| Путь | Ответственность |
|---|---|
| `prisma/schema.prisma` | 16 прикладных моделей, enum, связи, Decimal |
| `prisma/migrations/` | Три существующие SQL-миграции; история, не инструкция повторного применения |
| `prisma7.config.ts` | Пути Prisma и URL из окружения |
| `scripts/init-system-data.ts` | Создание отсутствующих stock1/2/3 и settings; **записывает БД** |
| `scripts/import/prodat.cjs` | Потоковый XML/ZIP, кодировки, структура и дедупликация |
| `prodat-normalize.cjs`, `prodat-import.cjs` | Каталог, staging, публикация и аудит |
| `prodat-barcodes.cjs`, `prodat-barcode-store.cjs` | EAN и защита ручных записей |
| `prodat-references.cjs`, `prodat-reference-store.cjs` | Фото, документы, analog/related |
| `prodat-slug.cjs`, `prodat-repair-slugs.cjs` | Создание slug; отдельный repair существующих slug |
| `pricat.cjs`, `pricat-normalize.cjs`, `pricat-import.cjs` | Чтение, нормализация и публикация PRICAT |
| `scripts/import/pricat-store.cjs` | Writer коммерческих данных и **общая** SQL-логика цены/доступности |
| `scripts/import/*.test.cjs` | Unit и integration; часть тестов создаёт временные БД |
| `web/app/` | App Router, каталог, карточка, ошибки, health endpoint |
| `web/lib/data.ts` | Пул, read-only транзакции, поиск/фильтры/страницы |
| `web/lib/availability.cjs` | Композиция SQL существующего readAvailableStocks без копирования правил |
| `web/components/photo.tsx` | Фото с заглушкой при ошибке |
| `web/tests/` | SQL-эквивалентность доступности и HTTP smoke |
| `web/Dockerfile`, `web/next.config.ts` | Production standalone |
| `deploy/storefront/` | Web/Caddy Compose, роль SELECT, запуск и локальная проверка |
| `docker-compose.yml` | Локальный Compose; не конфигурация работающего VPS PostgreSQL |

Имена модулей без полного пути в таблице относятся к `scripts/import/`.
Незакоммиченные `scripts/deploy/` основного checkout не входят в срез 2f20c29:
этот паспорт не обещает их наличие в чистом clone и не включает их в коммит.

## Runtime и зависимости

**КОД:** Node.js 24; root CommonJS и преимущественно `.cjs` импортёры.
Витрина — TypeScript, Next.js App Router, React. Root и `web/` имеют отдельные
package.json и lockfile. Фактически проверенный образ: Next.js 16.4.0,
React 19.3.0; semver-диапазоны package.json шире, воспроизводимость задают lockfile
и digest базового образа. Prisma объявлена в root 7.x.

Парсер использует sax, unzipper, iconv-lite; SQL — postgres.js; окружение — dotenv.
AdmZip используется, в частности, для тестовых ZIP. Наличие зависимости не
означает отдельный сервис. Root postinstall вызывает `prisma skills sync`;
это побочный эффект установки, не часть торговли.

## Запрос витрины

1. Параметры каталога нормализуются: q до 120 символов, category до 200, допустимые
   положительные page/brand; размер страницы 24.
2. Транзакция REPEATABLE READ READ ONLY получает каталог/бренды и множество кандидатов.
3. В режиме `stock` SQL доступности применяется **до** LIMIT/OFFSET и счётчика.
   `all` включает неархивированные товары без доступности.
4. Для страницы выбираются авторитетная цена и допустимые склады общими функциями.
5. Карточка получает изображения/документы и упаковку **источника выбранной цены**.

Поиск — параметризованный ILIKE по name, supplierCode, vendorNumber с экранированием
LIKE-метасимволов. Фильтр категории включает потомков. Это не полнотекстовый поиск
и не поиск по EAN/ETIM. API health проверяет процесс, не запрос к БД.
Пул ограничен четырьмя соединениями, default_transaction_read_only включён.

## Тестовое развёртывание

```mermaid
flowchart LR
  U["Браузер"] -->|"TCP 443, HTTPS + Basic Auth"| C["Caddy"]
  H["HTTP :80"] -->|"redirect HTTPS"| C
  C -->|"frontend network"| W["web :3000, UID 1000"]
  W -->|"external DB network / SELECT"| D[("postgres :5432 / тестовая БД")]
  C --- V["Постоянные caddy_data / caddy_config"]
  S["Секретные файлы вне Git"] -.-> C
  S -.-> W
```

**ЭКСПЛУАТАЦИЯ:** test.elektro-24.ru, VPS 168.113.208.94, Ubuntu 24.04;
основной домен магазина — elektrikamarket.ru, но он не является адресом этого релиза.
DNS: NIC.RU как регистратор elektro-24.ru, AdminVPS DNS, без Cloudflare в данной схеме.

Web/Caddy — отдельный Compose; PostgreSQL 17.11 — существующий контейнер.
Web/PG не публикуют host ports; Caddy публикует TCP 80/443; SSH 22 сохранён.
Caddy защищает весь сайт, добавляет noindex; owner/developer — аккаунты периметра,
не учётные записи или роли внутри приложения.

Образ содержит standalone server, static, public и внешний `pricat-store.cjs`.
Runtime read-only, cap_drop ALL для web, tmpfs для временных файлов/кеша.
`start.cjs` проверяет имя роли и конкретной тестовой БД; секрет не вшит в образ.
Расширение read-only набора таблиц требует отдельной проверки необходимости.

**Ограничения:** точный SQL-подсчёт наличия дорог; нет общего кеша доступности.
Фото/документы загружаются по внешним HTTP(S) URL, без медиа-хранилища и proxy.
Basic Auth сайта не защищает внешние ссылки. Защита HTTPS/noindex на периметре
не является пользовательской авторизацией магазина.
