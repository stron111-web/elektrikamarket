# Проверка интеграции витрины — 2026-10-29

## Происхождение

База: origin/main `50d02a2` с объединённым техническим паспортом (PR №2).
Ветка: `codex/integrate-storefront`, отдельный worktree.
Перенесены без конфликтов:

| Исходный коммит | Коммит интеграции | Назначение |
|---|---|---|
| ffae41d | d2f32c0 | Read-only Next.js MVP |
| 10f5495 | 7fe1aa5 | Точная доступность до пагинации |
| 2f20c29 | 620318b | Standalone Docker и Caddy |

`web/`, `deploy/`, .dockerignore, .gitattributes, .gitignore побайтно совпадают
с проверенным 2f20c29. Импортёры, Prisma, root package.json/lockfile не менялись.
AGENTS.md и все шесть разделов паспорта сохранены: обновлены только примечания
о наличии исходников, ссылка на readonly-role.sql и ссылка на этот отчёт.

## Фактически выполненные проверки

- Все четыре исходных worktree инвентаризированы. Три дополнительных worktree
  чистые; незакоммиченные файлы основного checkout сохранены. Старые ветки/worktree
  не удалены и не переписаны.
- Root `npm ci --ignore-scripts --no-audit --no-fund`: успешно, 166 пакетов;
  postinstall не запускался.
- 45 PRODAT unit-тестов: успешно. Файлы prodat.test, prodat-import.test,
  prodat-slug.test, prodat-barcodes.test, prodat-references.test.
- 2 PRICAT unit-теста: успешно; выбран точный test-name-pattern для
  `exact pricing and source mapping without conversion` и
  `ZIP Windows-1251 and strict XML failure`. DB integration не запускался.
- Production Docker build: успешно, Next.js 16.4.0, TypeScript check успешно.
  Новый локальный образ `elektrikamarket-storefront:integration-50d02a2`;
  manifest ID `sha256:f63452cb94da353fc1eca56795f06ebded355390319a75c6acab45fe71343495`.
  Build-контекст передаётся по allowlist, без секретов и БД.
- Compose config --quiet и Caddy validate: успешно с одноразовыми тестовыми
  файлами. Использован закреплённый Caddy digest из исходного релиза.
- Standalone запуск через start.cjs и GET /api/health: успешно.
  Контейнер с network=none, без host ports, UID 1000, read-only, cap_drop ALL.
  Применён одноразовый случайный нерабочий DB credential; подключений к БД нет.
- В runtime проверены 2116 файлов: отсутствуют .env, .git, ключи, дампы;
  присутствуют server.js, static/public, внешний pricat-store.cjs,
  доступны postgres/dotenv, DATABASE_URL не вшит в image environment.
- Отправляемая история и diff проверяются на приватные ключи, токены, literal
  passwords, строки подключения, env-секреты, bcrypt и чувствительные имена файлов.
  Два срабатывания в Docker-коммите проверены: placeholder пароля в README и
  генерация случайного пароля локальной fixture в check-local.cjs; это не секреты.
- Перед push проверены Markdown-ссылки, diff --check и сохранность исходных refs.

## Границы и риски

Это интеграция существующего проверенного MVP, не новая торговая реализация.
Требования Issue №1 о предварительном ассортименте ещё не реализованы;
«Все товары» остаётся тестовой диагностикой, не целевым публичным режимом.

В этой задаче PostgreSQL и VPS не использовались; миграции, импорт, восстановление,
DB suites, check-local.cjs и HTTP smoke каталога с реальными товарами не запускались.
Проверка health не доказывает доступность БД/цен/остатков. Исторические проверки
развёрнутого 2f20c29 описаны в паспорте и не выдаются за новый прогон.
Публичный ACME и логины VPS повторно не проверялись. Деплой не выполнялся.

Проверка зависимостей здесь — установка по lockfile, production build,
TypeScript и разрешение runtime imports; отдельный security advisory audit
npm не выполнялся. Новый image ID отличается от прежней сборки: это не
изменение исходников и не переключение VPS на новый образ.
