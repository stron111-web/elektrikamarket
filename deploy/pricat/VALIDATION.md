# Проверка PRICAT auto-update — 01.11.2026 (Europe/Astrakhan)

Ветка: codex/pricat-auto-update, база 7ca5122. Проверки относятся к локальной
реализации, не к включённому заданию на VPS.

## Новые фактические проверки

| Проверка | Результат |
|---|---|
| Mapping успешных импортов VPS, только SELECT | ImportFile 13: PRICAT1 / 2610 / ZIP; 14: PRICAT2 / 2630 / XML |
| FTP probe с VPS, без USER/PASS | greeting 220; AUTH TLS 500; AUTH SSL 500 |
| Расписание systemd, только `systemd-analyze calendar` на VPS | `*-*-* *:00:00 UTC` корректно; ничего не установлено/не включено |
| Полный Node-набор на новом локальном PostgreSQL 17 | 124 tests: 123 passed, 0 failed, 1 skipped; ~5.28 с выполнения тестов |
| Исторические tests PRODAT | Read-only fixtures git show 1d35206/a5d73f9; существующие assertions не менялись |
| Skip | Прежний opt-in полный PRODAT с исходными архивами |
| Сборка runtime Docker | PASS: Node24, npm ci с lockfile/basic-ftp 6.2.4 |
| Runtime hardening smoke | PASS: UID1001, read-only rootfs, cap-drop ALL, no-new-privileges, без сети/портов |
| Image whitelist | Только update/ftps/sync в scripts/pricat-update; без fixtures/tests/.env/.git/backups/docs/prisma/секретов |
| Bash/JSON | `bash -n run-update.sh`, оба JSON templates — PASS |
| Бизнес-код/схема/витрина | diff scripts/import, scripts/storefront, prisma, web относительно 7ca5122 пуст |

FTPS fixture использует собственный локальный CA, защищённые control/data sockets
и синтетические файлы. Подтверждены: отсутствие USER/PASS при отказе TLS и чужом
CA, явный отказ при недоступном PROT P, отказ login, изменение SIZE/MDTM во время
передачи, выбор только customerCode+warehouseCode+format, отказ ambiguous newest.

На отдельных случайных БД в новом локальном Docker PostgreSQL проверены:

- Bootstrap файлового кеша по полному SHA-совпадению с существующим active без
  повторного импорта; повторный hourly check без скачивания и audit.
- Один изменённый источник: скачан один, второй взят из последнего успеха.
- Оба изменены: одна парная публикация; два успешных SHA на источник; третья
  версия удалена только после подтверждения; metadata-only повторы не вытесняют историю.
- Ошибка каталога FTP, повреждённый кеш, stale lock, изменение второго источника
  во время скачивания — прежнее содержимое БД и успешные файлы сохраняются.
- Повреждённый ZIP в check и publish: CRC-отказ до импорта, state не изменён,
  future valid check не блокируется needs-review marker.
- Массовый скачок цены: транзакционный откат цен/остатков/active; все прежние
  успешные файлы побайтово целы; следующий запуск блокируется для разбора исхода.
- Прежние tests: MANUAL/locked, приоритет цен, защитная наценка, NMP/упаковки,
  три склада, карантин, дубль-padding, цена/quantity jumps и warehouse loss.

Полные TAP/stdout/stderr сохранены вне Git в private release-staging, каталог
`validated-em-pricat-regression-cb234faf3f5d`. Локальные Docker fixtures удалены
после проверки собственных меток; сохраняемые БД не использовались для записи.

## Что не проверялось и почему

Реальный FTP login/listing/download не выполнялся: endpoint не разрешил переход
на TLS, реальные credentials отсутствуют и не передавались. Поддержка SIZE/MDTM,
новые имена и DocumentNumber, timezone, завершённость генерации и supplier SHA
для текущей FTP-выгрузки требуют проверки после появления защищённого доступа.
Самостоятельно вычисленный SHA не является подписью поставщика.

Прогон на восстановленных 125082 реальных коммерческих позициях от 31.10.2026
не повторялся: это предыдущая проверка неизменённого import/publish пути, не новое
измерение FTPS-реализации. Текущий интеграционный прогон использовал синтетические
таблицы/файлы (10 товаров на fixture). Производительность реального FTP/импорта
на VPS не измерялась. Жёсткий crash/lost COMMIT не моделировались; markers требуют
ручной сверки вместо автоматического повторного импорта.

## До первого рабочего запуска

Получить защищённый канал РС и установить credentials private-файлом вне Git;
проверить текущий listing и неизменность timestamp-версий либо supplier HASH;
согласовать policy, settle window, timezone, DB и импортную роль. Сделать свежий
backup, отрепетировать свежую пару на восстановленной изолированной копии, затем
получить отдельное разрешение на publish и включение hourly timer. Образ, unit и
секреты не размещались на VPS. main/preview/friend, сайты и торговые данные не менялись.

## Дополнение: разрешённый обычный FTP поставщика

Отдельная ветка `codex/pricat-ftp-russvet` от `aa9d597`, решение владельца 01.11.2026.
Реализовано точное исключение: secure=false + allowPlaintextForRussvet=true только
service.russvet.ru:21021. Другой hostname/IP/порт или отсутствие флага отвергаются;
отсутствие secure означает FTPS. Автоматического downgrade нет.

Повторный полный Node-набор на новой локальной PostgreSQL 17: **126 tests,
125 passed, 0 failed, 1 skipped**, ~5.08 с; полный TAP/stdout/stderr вне Git,
`validated-em-pricat-regression-13af7024d220`. Кроме прежних проверок протестированы
матрица конфигурации endpoint/флаг/порт и настоящее passive FTP-скачивание двух
синтетических файлов на loopback: DNS hook существует только в тесте и не входит
в runtime, реальное подключение к поставщику не выполнялось. Проверена ошибка 530.
Все прежние проверки FTPS, цен, блокировок, публикации и retention прошли.

Python security tests получателя: **4/4 PASS** — UTF-8/кавычки, права 0700/0600,
отказ перезаписи и symlink, отказ публичного каталога/повреждённого payload.
Синтаксис sender проверен именно Windows PowerShell 5.1; отдельно проверена
передача синтетического Unicode JSON через BaseStream stdin дочернего процесса.
Реальная отправка FTP-реквизитов из Windows пока не проверена: ожидается ввод
владельца. При Restricted ExecutionPolicy подготовлена явная интерактивная команда,
не изменяющая системные/сеансовые политики.

На VPS подготовлены ТОЛЬКО новые /home/shopadmin/elektrikamarket-pricat-inputs
и downloads (0700), receive-credentials.py (0600), владелец shopadmin.
SHA-256 получателя совпал, --prepare вернул CREDENTIALS_READY; файла с паролем нет.
Существующие сервисы, БД и конфигурации не менялись, timer не установлен/не запущен.

5 товаров из свежей пары и фактические QTY пока не представлены: без реквизитов
файлы не скачивались. Нельзя заменять эту сверку старыми данными или fixtures.
После передачи разрешён только разовый listing/download/анализ без вызова updater,
DB URL в download-контейнере, реального импорта и изменения active snapshot.
