# Тестовая витрина: Docker + Caddy

Цель: https://test.elektro-24.ru/catalog.
Этот комплект не выполняет импорт, миграции, восстановление или переключение БД.
PostgreSQL остаётся в существующем Compose-проекте. Витрина подключается к
elektrikamarket_test_20261029t010219z_2761a73c ролью storefront_test_ro.

## Сборка в отдельном checkout

Из корня checkout ветки развёртывания:

    docker build -f web/Dockerfile -t elektrikamarket-storefront:<commit-sha> .

Node.js 24 закреплён digest. npm ci использует web/package-lock.json; root npm install
не нужен и не запускается. Сборка не получает DATABASE_URL. Docker context —
allowlist: web, scripts/import/pricat-store.cjs и snapshot reader-модули scripts/storefront.
Standalone включает server.js, зависимости, .next/static и public. Исходные
PRICAT-функции не изменяются. Внутри контейнера сервер слушает 0.0.0.0:3000;
host port для web отсутствует.

## Локальная проверка

После сборки, используя существующий приватный архив:

    node deploy/storefront/check-local.cjs <absolute-path-to-database.dump> elektrikamarket-storefront:<commit-sha>

Рядом с архивом должен лежать SHA256SUMS. Проверка создаёт ресурсы с уникальным
префиксом em-check-*, восстанавливает копию в собственный PostgreSQL-контейнер,
проверяет SELECT-роль, TLS с локальным CA, Basic Auth, статику и исходный smoke-тест
20 товаров/каталога/карантина. Сетевые порты на хост не публикуются.
В конце удаляются только ресурсы, успешно созданные этим запуском, и временные
секреты. Ни рабочая БД, ни VPS в проверке не участвуют.
Ожидается архив текущего набора с 148872 товарами; при смене эталона обновить проверку.
Локальный CA не подтверждает выдачу публичного ACME-сертификата: её проверяют на VPS.

## Первое развёртывание — только после отдельного разрешения

1. Проверить A/AAAA, свободные TCP 80/443, firewall VPS и firewall провайдера.
   DNS test.elektro-24.ru должен указывать на VPS. Не добавлять AAAA без рабочего IPv6.
   Открыть TCP 80/443; сохранить SSH. 3000, 5432 и Caddy admin API не публиковать.
2. Скопировать только deploy/storefront/{compose.yaml,Caddyfile,deploy.sh,readonly-role.sql} в отдельный
   /home/shopadmin/elektrikamarket-storefront. Не изменять Compose PostgreSQL и его том.
   Убедиться, что внешняя сеть elektrikamarket-deploy_default существует.
3. Подготовить образ с неизменяемым тегом commit SHA или digest. Получить его через
   закрытый registry либо docker save/load. Не собирать из незакоммиченных файлов.
4. Выполнить readonly-role.sql администратором именно в тестовой БД:

       docker compose --env-file /home/shopadmin/elektrikamarket-deploy/.env \
         -f /home/shopadmin/elektrikamarket-deploy/compose.yaml exec -T postgres \
         sh -c 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d elektrikamarket_test_20261029t010219z_2761a73c' \
         < readonly-role.sql

   SQL атомарен, отклоняет другую БД или существующую роль. Даёт SELECT на 13 таблиц,
   без sequence USAGE и доступа к истории миграций. Отзывает PUBLIC CREATE в public
   и PUBLIC TEMP только в тестовой БД. Не выполняет DML, не выдаёт default privileges.
   Проверить, что сетевые подключения роли требуют SCRAM-аутентификацию (не trust).
   Задать отдельный случайный SCRAM-пароль через интерактивный psql \password
   storefront_test_ro. Не передавать пароль в аргументах, истории shell или логах.
   У роли нет административных прав; default_transaction_read_only — дополнительная,
   а не единственная защита. Проверить также наследуемые PUBLIC privileges и
   SECURITY DEFINER-функции при будущем изменении схемы. PUBLIC CONNECT в других
   базах не отзывается глобально: ограничение роли одной БД через pg_hba при
   необходимости согласовывается отдельно.
5. Создать каталог секретов вне Git:
   /home/shopadmin/elektrikamarket-storefront-secrets, права 0700.
   В нём:
   - database_url: одна строка postgresql://storefront_test_ro:<urlencoded-password>@postgres:5432/elektrikamarket_test_20261029t010219z_2761a73c
   - basic_auth.caddy: строка <login> <bcrypt-hash>. Хеш получить caddy hash-password
     интерактивно, пароль не помещать в командную строку.
   - smoke.curl: приватная конфигурация curl с user = "login:password",
     права 0600; используется только deploy.sh на хосте.

   Файл database_url должен читаться UID 1000 контейнера (например, владелец UID 1000,
   mode 0400), basic_auth.caddy — Caddy (root в закреплённом образе), mode 0400.
   Проверить фактический UID владельца shopadmin. Если он отличается от 1000,
   настройку ownership выполняет администратор; не делать секрет world-readable.
   Compose file-based secrets — read-only bind mounts, не шифрованное хранилище.
   Скрипт запуска читает URL из файла и проверяет имя роли/БД; он не печатает URL.
6. Скопировать release.env.example вне Git как release.env, указать image SHA/digest,
   закреплённый digest Caddy и абсолютный путь каталога секретов.
   release.env не содержит паролей. Не использовать docker compose config без --quiet.
7. Выполнить:

       bash deploy.sh /absolute/path/release.env /absolute/path/smoke.curl

   Если образы доставлены через docker save/load, запустить с DEPLOY_PULL=never.
   Caddy защищает ВСЕ пути Basic Auth, перенаправляет HTTP на HTTPS, отдаёт noindex.
   Сертификаты и ACME-данные сохраняются в отдельных caddy_data/caddy_config volumes.
   Только web входит в сеть PostgreSQL; Caddy находится только в frontend-сети.
   Caddy admin API отключён. Healthcheck web проверяет процесс; deploy.sh дополнительно
   проверяет реальный каталог с БД и HTTP 401 без авторизации.

Если проверка не прошла, скрипт завершится с ошибкой. Он не удаляет контейнеры/тома,
не меняет данные и не выполняет автоматический разрушительный ремонт.
Диагностику читать локально: не публиковать логи с конфигурацией/SQL/секретами.

## Обновление через GitHub

Подготовить и проверить изменения в отдельной ветке, затем зафиксировать commit.
Рекомендуемый CI: GitHub Actions строит образ из конкретного SHA, проверяет зависимости,
публикует его в закрытый GHCR с тегом SHA и записывает digest. Пароли БД и Basic Auth
CI не нужны; личный Windows SSH-ключ в CI не копировать.
GitHub workflow в этот комплект не включён: права registry и способ утверждения
релизов следует согласовать отдельно. До этого возможны ручные build/push и запуск
одной deploy-команды на VPS.

В release.env изменить только STOREFRONT_IMAGE на новый проверенный digest.
Повторить deploy.sh. Он обновляет web/Caddy в отдельном Compose-проекте и проверяет
каталог. PostgreSQL не входит в этот проект. Схема, цены, остатки и импорт не меняются.
Для web возможен короткий перерыв соединений при пересоздании; rolling/blue-green
в этот первый вариант не входит. Не включать Watchtower или обновление latest.

## Откат

Перед обновлением deploy.sh сохраняет локальный image ID прежнего web в
previous-image-id. Сохранить и предыдущий release.env в защищённом каталоге.
Для отката приложения без pull и без изменения Caddy:

    cd /home/shopadmin/elektrikamarket-storefront
    STOREFRONT_IMAGE="$(cat previous-image-id)" docker compose \
      --env-file /absolute/path/release.env -f compose.yaml \
      up -d --no-deps --pull never --wait web

Затем выполнить авторизованный GET /catalog и убедиться, что без пароля возвращается
401. Не удалять предыдущий образ до приёмки релиза; на первом запуске previous-image-id
может быть пустым — автоматический откат невозможен.
Если менялся Caddyfile/Compose, вернуть также их согласованную предыдущую версию.
Не выполнять compose down -v, volume prune, migrations или повторное восстановление.

## Эксплуатационные ограничения

Каталог «В наличии» выполняет полный SQL-подсчёт; он может быть заметно медленнее
режима «Все товары». Тайм-аут роли 30 секунд и пул 4 соединения ограничивают нагрузку.
Web ограничен 768 МиБ/1.5 CPU, Caddy — 256 МиБ/0.5 CPU; лимиты корректировать по
замерам, сохраняя ресурсы PostgreSQL. Логи ротируются (3 x 10 MiB на сервис).
Внешние фото/документы зависят от доступности поставщика; Basic Auth защищает
сам сайт, но не сторонние URL. noindex не заменяет авторизацию.
