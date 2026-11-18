# Уведомления импортёров: подготовка, без включения

Отправитель: `info@elektrikamarket.ru`, получатель: `stron1@mail.ru`.
Официальные параметры: `smtp.mail.ru:465`, SSL/TLS с проверкой сертификата,
логин — полный адрес ящика. Нужен отдельный **пароль для внешнего приложения**,
предпочтительно с правом «Только отправка писем в Почте».
Источники: https://help.mail.ru/mail/login/mailer/ и
https://help.mail.ru/mail/faq/password/external/.
Администратор VK WorkMail должен разрешать SMTP и пароли приложений для этого ящика.
Пароль входа в ящик не требуется. Реальная авторизация ещё не проверена.

## Установка после отдельного разрешения

Ниже план будущей установки. Эти команды сейчас выполнять не нужно.
Исходный каталог релиза сначала сверяется по Git-коммиту и SHA-256 манифесту.
Испытательная копия исходников на VPS не считается установленной службой.
Сохранить существующую конфигурацию/крон/образы импортёров перед переключением.

В терминале `shopadmin`:

```sh
umask 077
install -d -m 0700 /home/shopadmin/elektrikamarket-import-monitor/bin /home/shopadmin/elektrikamarket-import-monitor/private /home/shopadmin/elektrikamarket-import-monitor/state
install -m 0600 deploy/import-monitor/monitor.py deploy/import-monitor/supervisor.py deploy/import-monitor/configure-smtp.py /home/shopadmin/elektrikamarket-import-monitor/bin/
test ! -e /home/shopadmin/elektrikamarket-import-monitor/config.json
install -m 0600 deploy/import-monitor/config.example.json /home/shopadmin/elektrikamarket-import-monitor/config.json
```

`test` предназначен для остановки перед перезаписью прежней настройки. Выполнять
последовательно, при любой ошибке остановиться. Конфигурация создаётся с
`mailEnabled=false`; пароль в ней отсутствует. Не копировать пароль в JSON вручную.
Не использовать `set -x`, запись сеанса или перенаправление ввода пароля.

После установки файлов владелец входит из PowerShell с выделенным TTY:

```powershell
ssh -t -i "$HOME/.ssh/elektrikamarket_vps" shopadmin@168.113.208.94 "python3 /home/shopadmin/elektrikamarket-import-monitor/bin/configure-smtp.py"
```

Программа дважды запросит пароль приложения, ввод не отображается. Она не
принимает пароль через аргументы, переменные среды или pipe и не проверяет почту.
Файл: `/home/shopadmin/elektrikamarket-import-monitor/private/smtp-password.json`,
владелец `shopadmin`, права `0600`, каталог `0700`. В контейнеры этот файл не монтируется.
Безопасная проверка разрешений (содержимое не выводится):

```sh
stat -c '%U %a %n' /home/shopadmin/elektrikamarket-import-monitor/private /home/shopadmin/elektrikamarket-import-monitor/private/smtp-password.json
python3 /home/shopadmin/elektrikamarket-import-monitor/bin/monitor.py --config /home/shopadmin/elektrikamarket-import-monitor/config.json --status
```

**Это не подтверждение доставки.** После отдельного разрешения нужен контролируемый
инцидент/восстановление в изолированном журнале и проверка получения двух писем.
`SMTP_ACCEPTED` означает принятие сервером SMTP, а не получение адресатом.

Перед включением проверить пути состояния обоих импортёров, часы UTC/NTP, интервалы
3/12 часов и полный выпуск PRICAT v2. Для PRODAT задать собственные явные runtimeLimits
и проверить живой прогресс на реальной копии. Нельзя устанавливать новые запускатели
без `supervisor.py`, проверенного образа и лимитов в конфигурации.
Затем явно включить `mailEnabled` и проверить очередь через `--status`:
старые учебные инциденты не переносить в рабочую очередь.
Никаких SMTP-паролей в параметрах процесса или unit-файлах.

Unit/timer устанавливаются обычным `sudo install` в `/etc/systemd/system/`, проверяются
`systemd-analyze verify` и только после разрешения включаются
`sudo systemctl enable --now elektrikamarket-import-monitor.timer`.
Таймер независим от `update.lock`, запускает наблюдатель каждые пять минут.
Он не запускает импорт, не обращается к БД и не управляет контейнерами.
При этом существующий контроллер конкретного импорта контролирует прогресс,
сохраняет логи и посылает только SIGTERM принадлежащему ему контейнеру.

## События и повторы

Один непрерывный сбой PRICAT (пара PRICAT1/2) или PRODAT — одно уведомление.
Повторный обход и смена симптома внутри того же сбоя новых писем не создают.
Успешная проверка после сбоя создаёт одно письмо о восстановлении.
Неизменившиеся FTP-файлы — успешная проверка, без писем.
Неизвестное время проверки, пропуск интервала с запасом, отсутствие прогресса,
превышение времени запуска, ошибка или маркер неопределённой публикации — сбой.
Лимиты времени технические, на долю исчезнувших товаров не влияют.

Очередь атомарно хранится в `state/state.json`. Повтор после явного отказа SMTP —
через 15 минут. Если ответ после DATA потерян либо процесс прерван во время отправки,
статус `DELIVERY_UNKNOWN`: автоматического повтора нет, чтобы не дублировать письма.
Такой случай требует проверки владельцем; гарантировать exactly-once средствами SMTP
невозможно. Ошибки SMTP видны в `--status` и journalctl; исключения с ответами сервера
и секретами не журналируются.

Состояние:

```sh
systemctl list-timers elektrikamarket-import-monitor.timer
journalctl -u elektrikamarket-import-monitor.service --since today --no-pager
python3 /home/shopadmin/elektrikamarket-import-monitor/bin/monitor.py --config /home/shopadmin/elektrikamarket-import-monitor/config.json --status
```

Откат уведомлений: `sudo systemctl disable --now elektrikamarket-import-monitor.timer`.
Это не меняет импортёры и их cron. Откат самого релиза требует вернуть сохранённые
запускатели/образы/конфигурации под общей блокировкой; откат БД автоматически запрещён.
