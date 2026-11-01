# Передача FTP-реквизитов и разовая проверка свежей пары

Решение владельца от 01.11.2026: разрешён обычный незашифрованный FTP только
`service.russvet.ru:21021`. Передача реквизитов от Windows к VPS идёт по SSH;
последующее соединение VPS → поставщик использует принятый владельцем plain FTP.
Не вводить пароль в чат, URL, аргументы программы, GitHub или `.env` репозитория.

## Реализованное исключение

В `ftp` одновременно задать:

```json
{
  "host": "service.russvet.ru",
  "port": 21021,
  "secure": false,
  "allowPlaintextForRussvet": true
}
```

Без `secure:false` используется FTPS. Plain FTP без разрешающего флага, другой
hostname/IP либо порт отклоняется до загрузки реквизитов/соединения. Отказ TLS
никогда автоматически не меняет протокол. Passive EPSV/PASV и запрет другого
transfer host сохраняются. FTP verbose выключен, в журнале только безопасные коды.
Остальные поля — в config.example.json; safety policy публикации не ослаблена.

## Что подготовлено на VPS

Только каталог `/home/shopadmin/elektrikamarket-pricat-inputs` (0700), его
`downloads` (0700) и исправленный `receive-credentials-v2.py` (0600),
принадлежащие shopadmin. Получатель проверяет владельца/права, не следует symlink,
пишет JSON только через stdin с O_EXCL, fsync и режимом 0600. Исправный существующий файл
не перезаписывает. Для известного дефекта Ctrl+V см. диагностику и -ReplaceInvalid. Он не подключается к FTP/PostgreSQL, не запускает расписание.

Файл назначения:
`/home/shopadmin/elektrikamarket-pricat-inputs/ftp-credentials.json`.
После первой передачи файл существует, но содержит ошибочный скрытый ввод.
Для повторной передачи используйте [диагностику](PRICAT_FTP_DIAGNOSTIC.md). Никаких секретов на Windows
сохранять не требуется. Получатель подготовлен этой задачей; если проверка его
SHA/готовности не пройдёт, sender остановится до запроса логина/пароля.

## Одна команда Windows

В обычном интерактивном PowerShell владельца (не в чате Codex), выполнить:

```powershell
powershell.exe -NoProfile -Command "& ([ScriptBlock]::Create([IO.File]::ReadAllText('C:\projects\elektrikamarket\backups\pricat-ftp-russvet\deploy\pricat\send-ftp-credentials.ps1'))) -ProjectRoot 'C:\projects\elektrikamarket\backups\pricat-ftp-russvet'"
```

Вставить блок целиком. Он не меняет ExecutionPolicy Windows (в проверенном
Windows PowerShell 5.1 установлена Restricted). Выполняется явно выбранный
локальный файл в интерактивном сеансе. Скрипт сначала проверит через SSH SHA-256 установленного получателя и его
готовность. Затем откроет штатный диалог Windows для FTP-логина и пароля.
Пароль скрыт, Ctrl+V вставляет текст в поле диалога. Не используйте прежний
консольный Read-Host -AsSecureString и не дописывайте значения в команду. JSON отправляется в stdin процесса
SSH как UTF-8; в argv только публичные SSH-параметры. Используются существующий
ключ `%USERPROFILE%\.ssh\elektrikamarket_vps`, BatchMode=yes,
StrictHostKeyChecking=yes и ConnectTimeout=15. Содержимое приватного ключа
скрипт не читает и не копирует. При необходимости другой путь к уже существующему
SSH-ключу передать через `-KeyFile` (это путь, не пароль).

Успех: `Credentials saved on VPS (0600). No FTP login, import or schedule was started.`
Не пересылать значения; достаточно сообщить «реквизиты переданы». Пароль не
сохраняется в локальный файл или history. Управляемые строки временно существуют
в памяти процесса; SecureString/unmanaged buffers и byte buffer освобождаются.
Не запускать под отладчиком, не добавлять echo/Write-Host переменных с реквизитами.

Если файл уже существует или передача завершилась неопределённо — не удалять и
не перезаписывать вслепую; проверим только наличие/права и продолжим по состоянию.

## VPS: необязательная проверка без раскрытия содержимого

В своей SSH-сессии shopadmin:

```bash
stat -c '%a %U:%G %n' \
 /home/shopadmin/elektrikamarket-pricat-inputs \
 /home/shopadmin/elektrikamarket-pricat-inputs/downloads \
 /home/shopadmin/elektrikamarket-pricat-inputs/ftp-credentials.json
```

Ожидаются 700/700/600, владелец shopadmin:shopadmin. `cat`, `echo`, expanded
Compose config и вывод JSON не нужны. Никаких sudo/systemctl/import команд.

## Следующий этап — только после получения реквизитов

1. Одно соединение клиента с VPS к фиксированному FTP, listing обеих папок,
   выбрать newest `PRICAT_891661_2610_<date>.zip` и
   `PRICAT_891661_2630_<date>.xml`, без получения старых версий/всей папки.
2. Скачать только эти два файла в новый закрытый каталог внутри downloads,
   без DB URL и без вызова sync/update/importPricat. Проверить SIZE/MDTM до/после,
   SHA-256 локальной копии, ZIP CRC/лимиты и штатный readPricat для XML/дат/identity.
   Если реальные имена/метаданные отличаются, остановиться и согласовать контракт.
3. Сопоставить SenderPrdCode, выбрать пять общих товаров с ненулевыми и желательно
   разными QTY. Для наименований использовать поля файлов, если они есть, либо
   отдельный read-only SELECT существующего Product. Значения QTY брать прямо
   из двух новых файлов, не из старого snapshot и не из PartnerQTY/SumQTY.
   При несовместимых единицах показать UOM и не выдавать числа за сопоставимые.
4. Выдать таблицу код РС / наименование / QTY 2610 / QTY 2630, указать даты файлов;
   до сверки владельцем не придумывать названия складов. Если подходящих общих
   товаров меньше пяти, сообщить фактическое число.

Этот документ не разрешает реальный импорт, изменение снимка, установку/запуск
systemd или изменение сайтов. Почасовая обвязка, атомарность, защита цен и
retention двух успешных версий остаются прежними, но не активируются.
