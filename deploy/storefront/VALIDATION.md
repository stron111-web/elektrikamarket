# Локальная проверка Docker-развёртывания — 2026-10-29

База ветки: feat/storefront-mvp, 10f5495836ed1c1bc374d93c8abec5481fa98934.
Работа выполнена в отдельном worktree; VPS не изменялся.

## Итоговый образ

- Tag: elektrikamarket-storefront:local-check
- ID: sha256:9effc1ccd27c331350ffd8b061dbc1332814ff9dece25ff964ed329ff1841df8
- Docker reported size: 402294804 bytes (~383.7 MiB).
- Node.js 24, Next.js 16.4.0, production webpack build + TypeScript: PASS.
- Caddy: 2.11.7; digest закреплён в release.env.example.
- Runtime UID 1000, read-only filesystem + tmpfs: PASS.
- Проверены 2116 файлов приложения: нет .env, ключей, дампов, .git, backups.
- DATABASE_URL отсутствует в окружении образа; секрет читается только при запуске.
- server.js, внешний pricat-store.cjs, public и .next/static присутствуют.

## Интеграционный тест

Создана отдельная локальная копия архива с 148872 товарами. Рабочая БД Windows
не использовалась. Все временные контейнеры, сеть, том и секреты удалены после теста.

- Docker Compose config --quiet: PASS.
- HTTPS Caddy с локальным доверенным CA: PASS.
- 401 без авторизации для каталога, карточек, health и /_next: PASS.
- 401 с неправильным паролем: PASS.
- X-Robots-Tag noindex, включая ответы 401: PASS.
- Авторизованная загрузка HTML и статических файлов: PASS.
- Роль storefront_test_ro: ровно 13 таблиц SELECT, 0 таблиц с правами записи: PASS.
- UPDATE запрещён даже после SET default_transaction_read_only=off: PASS.
- SELECT _prisma_migrations и nextval(products_id_seq) запрещены: PASS.
- Исходный smoke-тест 20 товаров (PCE/MTR/NMP), цены и остатки: PASS.
- Карантин 10 реальных товаров, поиск, категории, бренд, пагинация и 404: PASS.
- Нет опубликованных host ports у тестовых PostgreSQL, web и Caddy: PASS.
- Число товаров в тестовой копии после проверок не изменилось: PASS.
- Торговые модули scripts/import и web/lib совпадают с исходной веткой.

Исправлено при проверках: чтение сертификата из tmpfs через docker exec вместо
docker cp и noindex в обработчике ошибок Caddy. Временные TLS timeouts Docker Hub
потребовали повторной сборки; итоговая сборка успешна. Тест использует уже загруженный
Caddy по закреплённому digest и не требует повторной загрузки при каждом запуске.

## Границы проверки

Публичный ACME-сертификат, firewall VPS и права файлов секретов на Linux проверяются
на отдельном этапе развёртывания. Локальный CA не является проверкой публичного ACME.
GitHub Actions/registry не настраивались; порядок обновления описан в README.md.
Существующая публикация 5432 локального рабочего PostgreSQL не менялась; новые
тестовые контейнеры ничего на хост не публиковали.
