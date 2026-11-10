# Preview: устранение выдачи секретов и подключение DaData

## Статус подготовки — 10 ноября 2026

**На VPS изменения не применены. Push не выполнен.** Текущий работающий Preview
по-прежнему содержит прежнюю реализацию `/admin/keys`. Нельзя вводить новые ключи
до развёртывания исправленного образа. Основной checkout и main не изменялись.

Рабочая ветка: `codex/preview-dadata-security`, создана от
`preview/friend@2e58d58dc15af875f58a4b31e923e4b7f16f2bb6`.
Она содержит исходную функциональность
`3d84e8cfd49e9c489e43692663c3e778368599be` (проверено по Git ancestry).
Минимальный коммит безопасности: `77fd05e62030050b728d940326315e675b62e89e`.

Установленное состояние, проверенное только чтением:

- Preview: `elektrikamarket-preview-preview-1`, healthy, revision `2e58d58`,
  Image ID `sha256:b1213b6a8ef7ec68f077e2169c7d791deb86b2a1b4b8b3692e4648eaa7572a10`.
- Root Compose: `/etc/elektrikamarket-preview/compose.yaml` (JSON).
- Deployer: `/usr/local/sbin/elektrikamarket-preview`;
  состояние `/var/lib/elektrikamarket-preview/images.json`;
  общая блокировка `/var/lib/elektrikamarket-preview/deploy.lock`.
- СДЭК загружается отдельным preload из существующего защищённого файла.
  Его значения не читались и не изменялись; меню `cdekpreview` не меняется.

Повторная проверка в конце подготовки: ID/образ/время старта Preview, Test и
PostgreSQL совпали с началом; Caddy работает с прежним ID и временем старта.
HTTPS `/catalog` обоих стендов без авторизации возвращает 401, сертификаты
проверены штатным curl без отключения TLS-проверки. Это не заменяет будущую
проверку формы с реальными ключами после разрешённого обновления.

## Исправление безопасности

Удалены `key-store.ts`, `key-actions.ts`, `admin-keys.tsx`, ссылка в админке.
Жёстко заданный пароль не заменяется новым: механизм просмотра секретов удалён.
`/admin/keys` и дочерние пути блокируются proxy: 404 для HTML, HEAD, RSC и POST,
включая обращения к прежнему server action. Страница дополнительно вызывает
`notFound()`. Ответы не кэшируются. Другие административные маршруты не открываются.

DaData доступна только через `server-only`; браузер получает четыре разрешённых
поля организации, либо фиксированную безопасную ошибку. Исключения поставщика,
ключи, баланс аккаунта и исходный JSON в браузер не возвращаются. Перенаправления
HTTP запрещены. В production нет чтения ключей из developer-local файлов.

Обнаруженная выдача ключей означает, что прежние секреты могли быть доступны
пользователям с доступом к старой странице. Факт чтения или утечки не установлен.
Удаление страницы не отзывает уже полученные значения и не удаляет старый пароль
из истории Git. Решение о ротации существующих ключей — отдельное; ключи СДЭК
в этой задаче не меняются.

Lockfile содержал Next 16.4.0 с известными уязвимостями, поэтому зафиксирована
версия 16.4.5. Основание: [официальное уведомление Next.js](https://nextjs.org/blog/nextjs-security-update-october-14-2026).
Для production-зависимостей `npm audit` после обновления: 0 уязвимостей.
Это результат проверки известных уязвимостей, а не гарантия отсутствия любых ошибок.

## Хранение и применение

Новый файл: `/etc/elektrikamarket-preview/dadata-credentials.json`.
В нём только `DADATA_API_KEY` и `DADATA_SECRET_KEY`.
Владелец UID/GID 1000:1000, права **0400**, родительский каталог остаётся закрытым
для других пользователей. Такая схема нужна непривилегированному UID 1000 внутри
контейнера; файл не становится доступным пользователю `cdekpreview` UID 1500.

Compose монтирует файл только в Preview, read-only,
`/run/secrets/preview_dadata_credentials`. Самих значений в Compose и Docker
Config.Env нет. Preload `/run/preview-dadata/load-dadata-secret.cjs` читает их
в окружение серверного Node-процесса при старте; `NEXT_PUBLIC_*` не используются.
Preload проверяет маркер безопасного образа **до** загрузчика СДЭК.

Root-команда `/usr/local/sbin/elektrikamarket-preview-dadata` поддерживает только:
`set`, `verify`, `status`, `rollback`. Новых sudo-разрешений, SSH-пользователей
или независимого deployer не создаётся. Используется уже имеющийся sudo владельца.
Для этой конкретной команды отключается sudo I/O-логирование; ввод через getpass
не отображается и не попадает в argv, историю команд или журналы команды.
Не вводить ключи внутри `Start-Transcript`, `script`, записываемого терминала
или внешней системы аудита сеанса: sudo не может отключить стороннюю запись.

До запроса ключей проверяются текущий digest, OCI revision/labels, здоровье,
маркер, наличие коммита безопасности среди предков через публичный GitHub API,
404 на закрытом маршруте. Недоступность GitHub или несоответствие останавливают
процедуру. Настройки применяются только после успешного запроса к DaData.

Верификация пары использует [profile/balance](https://dadata.ru/api/balance/)
(проверяет оба ключа), затем [findById/party](https://dadata.ru/api/find-party/)
для ИНН `7707083893`. Результат содержит только `accepted` и логические признаки
`company/address/kpp/ogrn`; сумма баланса, ключи и ответы поставщика не печатаются.
Это чтение справочника, без регистрации пользователя, создания заказа или записи в БД.

После сохранения настроек существующий deployer вызывается под его же deploy.lock,
с тем же текущим immutable image и `force_recreate=True`, только для `preview`.
Далее проверяются каталог, HTTPS с прежней Basic Auth и запрос DaData из процесса
с подключённым preload. Проверяются неизменность файлов СДЭК, image-state,
cron и контейнеров других постоянных сервисов.

GitHub по-прежнему обновляет образ через существующий deployer. Он использует тот
же root Compose: новые mount/preload сохраняются при последующих обновлениях.
Репозиторный шаблон `deployer.py` синхронизирован с уже установленным параметром
`force_recreate`; заменять root deployer при этой установке не требуется.
Автоматическое обновление на старый образ без маркера остановится до загрузки
секретов. Это защита от раскрытия, но такой образ не запустится.

## Что проверено локально

- Production-сборка Next 16.4.5 и TypeScript: успешно.
- 7 тестов безопасного server DTO, ошибок провайдера и реального обработчика
  автозаполнения формы: успешно (название, адрес, КПП, ОГРН; другие поля сохранены).
- 3 теста preload: UID/права/состав файла, отказ для старого образа, СДЭК сохранён.
- 9 Python-тестов пакета/установки/защиты/повторяемости и восстановления настроек при
  отказе пересоздания либо частичной записи файлов: успешно.
- 1 HTTP-тест запущенной production-сборки: HTML/HEAD/RSC/старый action POST,
  три варианта пути `/admin/keys`; 404, no-store, синтетические секреты отсутствуют
  в ответах и логах; DATABASE_URL вообще не задан.
- 6 существующих тестов границ startup Test/Preview: успешно.
- `npm audit --omit=dev`: 0 уязвимостей; `git diff --check`: без ошибок.

Root-установка и реальные ключи на VPS **ещё не испытаны**. Docker-образ на VPS
не обновлялся; GitHub workflow ещё не запускался для этого исправления.
Проверка боевого DaData и сохранения настроек при настоящем обновлении образа
будет возможна после отдельного разрешения. Текущие выводы по сохранению при
обновлении основаны на проверенном Compose/deployer и тестах, а не новом деплое.

## Порядок установки — только после отдельного подтверждения

Все команды ниже выполняет владелец в PowerShell. Пароль sudo вводится только
по запросу sudo. Никаких ключей DaData в текст команд не добавлять.

### 1. Проверить и передать пакет публичных скриптов

Локальный пакет подготовлен здесь:
`C:\projects\elektrikamarket\outputs\preview-dadata-setup\preview-dadata-setup.tar.gz`.
Его SHA256 приложен рядом в `SHA256.txt`. В архиве только пять публичных файлов
и manifest; нет конфигурации, ключей, паролей или дампов.

Первая команда проверки:

```powershell
Get-FileHash -Algorithm SHA256 "C:\projects\elektrikamarket\outputs\preview-dadata-setup\preview-dadata-setup.tar.gz"
```

Сверить с `SHA256.txt`, затем после подтверждения установки:

```powershell
scp -i "$env:USERPROFILE\.ssh\elektrikamarket_vps" "C:\projects\elektrikamarket\outputs\preview-dadata-setup\preview-dadata-setup.tar.gz" shopadmin@168.113.208.94:/home/shopadmin/preview-dadata-setup.tar.gz
ssh -i "$env:USERPROFILE\.ssh\elektrikamarket_vps" -o StrictHostKeyChecking=yes shopadmin@168.113.208.94 "sha256sum /home/shopadmin/preview-dadata-setup.tar.gz"
```

Сравнить серверный SHA256 с локальным. Затем открыть обычный SSH:

```powershell
ssh -t -i "$env:USERPROFILE\.ssh\elektrikamarket_vps" -o StrictHostKeyChecking=yes shopadmin@168.113.208.94
```

В этом сеансе под shopadmin выполнить последовательно:

```sh
umask 077
mkdir /home/shopadmin/preview-dadata-setup
tar -xzf /home/shopadmin/preview-dadata-setup.tar.gz -C /home/shopadmin/preview-dadata-setup
sudo /usr/bin/python3 -I /home/shopadmin/preview-dadata-setup/backup-preview.py
```

`mkdir` без `-p`: существующий каталог — повод остановиться и проверить его,
а не перезаписать предыдущую установку. Не продолжать после ошибки любой команды.
Скрипт дополнительно проверяет manifest до чтения root-конфигурации.
Создаётся root-only каталог
`/var/lib/elektrikamarket-preview/dadata/before-security-image-*`:
Compose, images.json, публичные загрузчики СДЭК/shop и метаданные контейнеров.
Пароли СДЭК/БД не копируются и не печатаются; существующие файлы остаются на месте.
Образ не удаляется, контейнеры не меняются; результат `servicesChanged=false`.

### 2. Опубликовать исправленный Preview обычным механизмом

После резервирования и до любых ключей требуется исправленный образ.
В отдельном окне PowerShell следующая команда запускает существующий GitHub
workflow и обновляет **только Preview**. Сейчас её не выполнять.

```powershell
git -C "C:\projects\elektrikamarket\backups\preview-dadata-security" push origin HEAD:preview/friend
```

Без `--force`: если Андроник обновил ветку, команда должна остановиться,
сначала нужно проверить и согласовать новые изменения. Дождаться успешного
существующего workflow `Preview storefront`, включая deploy и health-check.
Штатный deployer сохраняет предыдущий image reference и не удаляет прежний образ.
Не выполнять generic image rollback после ввода DaData: старый образ уязвим.

### 3. Установить helper, затем скрыто ввести и применить ключи

В прежнем SSH-сеансе shopadmin:

```sh
sudo /usr/bin/python3 -I /home/shopadmin/preview-dadata-setup/bootstrap.py
```

Эта команда устанавливает только root helper, публичный loader и узкое правило
отключения sudo I/O-логирования. Сохраняет резервную копию Compose и контрольные
суммы в `/var/lib/elektrikamarket-preview/dadata/helper-installation-backup-*`.
Не меняет Compose/контейнер, не спрашивает ключи и не выдаёт новых sudo-прав.
Ожидается `prepared=true`, `runtimeChanged=false`, `cdekUnchanged=true`.
При уже установленном helper повторный bootstrap остановится.

В том же обычном SSH-сеансе:

```sh
sudo /usr/local/sbin/elektrikamarket-preview-dadata set
```

Ввести поочерёдно `DADATA_API_KEY`, `DADATA_SECRET_KEY` в скрытых приглашениях.
Команда проверит оба ключа, создаст закрытую резервную копию Compose/прежних DaData
в `/var/lib/elektrikamarket-preview/dadata/backup-*`, подключит новые mount/preload
и пересоздаст **только Preview**, сохранив тот же текущий образ. Возможен короткий
перерыв Preview при пересоздании. При ошибке автоматически вернутся только
предыдущие настройки Preview/DaData с тем же безопасным образом.

Ожидается `applied=true`, `accepted=true`, четыре поля `true`,
`cdekUnchanged=true`, `otherContainersUnchanged=true`, `imageStateUnchanged=true`.
Повторный `set` с теми же настройками проверяет API, но контейнер не пересоздаёт.
Если возвращена ошибка — остановиться, сохранить только безопасный код причины;
не повторять bootstrap, не копировать expanded Compose или секретный JSON в чат.

### 4. Проверки

```sh
sudo /usr/local/sbin/elektrikamarket-preview-dadata verify
sudo /usr/local/sbin/elektrikamarket-preview-dadata status
```

`verify`: только запросы чтения, ожидается `accepted=true`, все четыре поля `true`.
`status`: наличие конфигурации и безопасные сведения о последнем применении.

В браузере с прежним доступом Preview открыть `/register`, выбрать юридическое
лицо, ввести корректный ИНН, нажать «Подставить реквизиты по ИНН» (либо Enter).
Проверить заполнение названия, адреса, КПП, ОГРН. Не отправлять регистрацию.
Открыть `/admin/keys`: ожидается 404; без прежней Basic Auth Preview всё ещё 401.
На Test ничего не устанавливать. После следующего обычного успешного обновления
Preview повторить `verify`: это подтвердит сохранение при реальном новом image.

### 5. Откат только DaData

```sh
sudo /usr/local/sbin/elektrikamarket-preview-dadata rollback
```

Восстанавливает Compose и прежние DaData из последней успешной установки,
пересоздаёт только Preview с **текущим исправленным образом**, не меняет ключи
СДЭК, deployer, images.json, cron, Test или базы. Ожидается `rolledBack=true`.
Не откатывает последующие чужие изменения Compose: при расхождении хеша откажет
и потребует проверки владельцем. Также требует healthy текущего безопасного образа;
при неработающем Preview нужен отдельный разбор, без слепого восстановления.
После успешного отката не повторять его как универсальный repair.

Резервные файлы остаются root-only на VPS. Удаление helper/backup не требуется
для отключения DaData и не входит в автоматическую процедуру.
