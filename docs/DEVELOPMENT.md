# Технический паспорт: совместная разработка и эксплуатация

Срез/статусы: [ARCHITECTURE](ARCHITECTURE.md). Постоянные правила — [AGENTS.md](../AGENTS.md).
Документ не содержит секретов и не даёт бессрочного разрешения на изменения VPS/БД.

## Работа владельца, Codex и Cursor

**РЕКОМЕНДУЕМЫЙ ПРОЦЕСС:** один task — одна ветка и отдельный worktree/clone.
Не открывать два пишущих агента в одном worktree. Не сбрасывать чужой diff и
не выполнять git clean/reset ради удобства. Основной checkout остаётся владельцу.

Перед работой:

```bash
git status --short
git branch --show-current
git worktree list
git log -1 --oneline
```

Согласовать базу. Развёрнутый релиз — `codex/storefront-docker@2f20c29`;
`feat/storefront-mvp` — предыдущая база витрины. Новая задача не должна случайно
потерять Docker-изменения, начавшись от более старой ветки.

Пример создания изолированной ветки документации/задачи
(выбрать свободные путь и имя, не выполнять поверх существующего):

```bash
git worktree add -b codex/<task> ../elektrikamarket-<task> 2f20c29
```

Открыть этот каталог в Cursor или Codex. Явно дать агенту AGENTS.md и нужные docs;
не считать, что каждая версия IDE автоматически прочитала все Markdown.
Для Cursor не требуется копировать торговые правила в отдельный расходящийся
файл: ссылаться на единые документы и модули.

Коммитить только файлы задачи явным списком. Проверить staged diff, отсутствие
секретов/архивов и unrelated файлов. Push своей ветки и PR — после разрешения
публикации. Не работать прямо в main, не force-push общую ветку.

PR описывает проблему, поведение после изменения, бизнес-инварианты, тесты,
влияние на схему/права и откат. При изменении торговой логики нужны тесты
manual/locked, приоритетов, обоих источников, трёх складов и карантина.
Слияние выполняет согласованный reviewer; branch protection/обязательные checks
на GitHub в рамках паспорта **не проверены**, их нельзя объявлять настроенными.

## Зависимости и локальный запуск

Node.js 24. Root и web устанавливаются отдельно по lockfile. Root postinstall
имеет побочный `prisma skills sync`; для воспроизводимой установки без него можно
использовать `npm ci --ignore-scripts`, отдельно оценив нужные lifecycle scripts.
Никакие секреты в clone/worktree автоматически не копировать.

Витрина при локальном запуске читает DATABASE_URL из окружения либо ../.env.
Использовать отдельную локальную копию/роль SELECT, не admin URL рабочего кластера.
URL не помещать в аргументы команд, NEXT_PUBLIC_* или текст PR.

После безопасной подготовки окружения:

```bash
cd web
npm ci
npm run typecheck
npm run build
npm run dev
```

Локально Next слушает 127.0.0.1:3000; production Docker запускает standalone server
внутри контейнера. Build не требует пароля рабочей БД и не запускает миграции.
Root `npm test` — заглушка с ошибкой, это не полный тест проекта.

## Матрица тестирования и побочных эффектов

| Проверка | Что проверяет | Что может изменять |
|---|---|---|
| prodat.test, prodat-import.test, prodat-slug.test, prodat-barcodes.test, prodat-references.test | Парсер, нормализация, identities/slug | Локальные временные fixtures; не production import |
| prodat-integration.test.cjs | Атомарность, locks, слои, повтор, recovery | Создаёт случайную prodat_test_* БД, применяет SQL-миграции туда и удаляет её |
| pricat.test.cjs / npm run test:pricat | В том числе реальные SQL-сценарии карантина/цен | Создаёт pricat_test_* БД, миграции/fixtures/cleanup; **не чистый unit suite** |
| npm run test:import | Все *.test.cjs | Включает оба DB integration suite |
| web/tests/availability.cjs | SQL-эквивалентность доступности | Только чтение выбранной БД |
| web/tests/smoke.cjs | 20 товаров, цены/склады, поиск, карантин, HTTP | Чтение БД и HTTP; привязан к конкретному набору данных |
| deploy/storefront/check-local.cjs | Изолированная копия dump, роль, Caddy TLS/auth, smoke | Временные Docker сеть/том/контейнеры, restore и cleanup именно fixtures |
| web build/typecheck | Сборка и TS | Локальные build-артефакты |

Для DB suites явно использовать PRODAT_TEST_ADMIN_URL/PRICAT_TEST_ADMIN_URL
**отдельного локального тестового кластера**, где разрешены CREATE/DROP DATABASE.
Fallback в DATABASE_URL существует в коде; не полагаться на безопасный URL по имени.
Суффикс test у сохраняемой VPS БД не делает её одноразовой.
PRODAT_FULL_TEST=1 требует реальных архивов и исторических Git checkpoints,
тяжёлый и не является стандартной проверкой каждого Markdown-изменения.

При задаче «без миграций/импортов/изменений БД» DB suites и check-local не запускать.
Для документации достаточно сверки источников, ссылок, diff и секретов.
В этой задаче выполнена статическая проверка; старые результаты тестов не
представляются как повторный запуск.

Smoke по исходникам ориентирован на локальный HTTP и не добавляет Basic Auth.
Для защищённого VPS нужен отдельный безопасный harness с credentials из файла/
stdin, не password в CLI. Длинный HTTP smoke держит read-only транзакцию:
при необходимости увеличить idle timeout **только тестовой транзакции**,
а не глобальные настройки роли. При развёртывании именно этот тестовый тайм-аут
потребовал такой корректировки; приложение не менялось.

## Развёрнутый тестовый контур

**ЭКСПЛУАТАЦИЯ, 2026-10-29, не новая проверка:**

| Объект | Значение |
|---|---|
| URL | https://test.elektro-24.ru/catalog |
| Хост / SSH user | 168.113.208.94 / shopadmin |
| Версия | codex/storefront-docker, 2f20c29 |
| Каталог релиза | /home/shopadmin/elektrikamarket-storefront |
| Compose витрины | /home/shopadmin/elektrikamarket-storefront/deploy/storefront/compose.yaml |
| Параметры релиза | /home/shopadmin/elektrikamarket-storefront/release.env |
| Секреты | /home/shopadmin/elektrikamarket-storefront-secrets |
| Существующий PG Compose | /home/shopadmin/elektrikamarket-deploy/compose.yaml |
| Внешняя DB network | elektrikamarket-deploy_default |
| БД / роль | elektrikamarket_test_20261029t010219z_2761a73c / storefront_test_ro |
| Basic Auth | Отдельные owner и developer; только хеши для Caddy |

Фактический путь Compose вложенный: Git archive сохранил deploy/storefront.
Старые примеры README с compose.yaml непосредственно в корне релиза
нельзя копировать без поправки пути.

Секреты file-based, вне Git: database_url, basic_auth.caddy, приватные curl configs
и файлы выдачи доступа. Пароли/хеши/URL с credentials здесь не приводятся.
Файл БД читается UID 1000 контейнера; shopadmin на текущем VPS UID 1001.
Каталог секретов 0700; database_url 0440 owner=1000/group=1001,
остальные созданные приватные файлы 0600. Не делать world-readable ради Docker.
Права других серверов проверять заново; UID нельзя угадывать.

Caddy получает два bcrypt-хеша; web получает только DB secret. TLS сертификаты
в постоянных volumes Caddy. Во время запуска проверены доверие Let's Encrypt,
401 без авторизации, оба логина, noindex, карточки/статика, 20 товаров и 10
карантинных позиций. Сертификат тогда действовал до 2027-01-27;
это дата наблюдения, не обещание будущего продления без мониторинга.

Простой внешний TCP-connect тест с Windows дал неоднозначный результат для
3000/5432; на VPS ss и Docker PortBindings подтвердили отсутствие публикаций,
HTTP/PG protocol probe снаружи ответа приложения не получил. Firewall правила
хоста/провайдера отдельно не инвентаризированы. Не подменять это утверждением
о полностью проверенной конфигурации firewall.

## Обновление через GitHub

**КОД:** deploy.sh принимает release.env и приватный curl config; lock защищает
от одновременных запусков, сохраняется прежний image ID, Compose обновляет только
web/Caddy, затем проверяются авторизованный каталог и anonymous 401.

**ПРОЦЕСС:** reviewed PR → согласованный merge/commit → сборка точного SHA →
локальные проверки → доставка image → фиксация immutable image ID/digest →
отдельное разрешение владельца → deploy → smoke → отчёт.

Выполненное первое развёртывание использовало docker save/load и SHA256 архивов,
не Git pull на VPS и не автоматический GitHub Actions. GitHub Actions/GHCR workflow
в срезе отсутствует. При его будущем внедрении не помещать DB secrets и личный
Windows SSH-ключ владельца в build/CI; отдельно согласовать release credentials.

Только после разрешения обновления и доставки проверенных локальных образов:

```bash
DEPLOY_PULL=never bash /home/shopadmin/elektrikamarket-storefront/deploy/storefront/deploy.sh \
  /home/shopadmin/elektrikamarket-storefront/release.env \
  /home/shopadmin/elektrikamarket-storefront-secrets/owner.curl
```

Образы текущего release.env закреплены локальными SHA image ID; не использовать
default pull=always для такого релиза. Перед обновлением сохранить release.env
и конфигурацию, убедиться, что прежний образ остаётся локально.
Первый запуск Caddy требует времени на ACME; deploy.sh не содержит отдельного
ожидания выпуска сертификата после запуска, поэтому учитывать этот предел.
Автоматического отката и zero-downtime переключения нет.

## Откат только витрины

Первый релиз: остановить web/Caddy, сохраняя PostgreSQL и тома.
Созданный при развёртывании серверный helper (не файл репозитория):

```bash
bash /home/shopadmin/elektrikamarket-storefront/rollback-stop.sh
```

После будущего обновления deploy.sh сохраняет previous-image-id **рядом с собой**
(`deploy/storefront/previous-image-id`). После проверки файла можно вернуть web
с этим image ID через Compose up --no-deps --pull never --wait web, передав
STOREFRONT_IMAGE из сохранённого ID, и проверить HTTP/auth.
Если изменялся Caddy/Compose, отдельно вернуть согласованную конфигурацию.
Не использовать down -v, volume prune, reset БД или restore для отката UI.
БД/схема/импорт не должны быть частью команды развёртывания витрины.

## Доступ коллеги

Владелец получает отдельный developer credential через приватный канал/менеджер
паролей. Не отправлять owner credential, DB URL, .env или SSH private key.
Файлы выдачи доступа не прикладывать к issue/PR/чату агента.
Наличие Basic Auth developer не даёт GitHub/SSH/DB прав — их выдача отдельная задача.
