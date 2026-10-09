# PRODAT references: проверка 2026-10-09

Только временная БД `prodat_test_61468_b26abc4405c0a86e` (удалена после теста). Рабочая elektrikamarket не изменена. HTTP-запросов и скачивания файлов не было.

## Результаты

| model | count |
| --- | --- |
| products | 148872 |
| brands | 382 |
| categories | 244 |
| product_barcodes | 130972 |
| product_images | 391505 |
| product_documents | 321197 |
| product_relations | 519990 |

Relations: resolved=328445, unresolved=191545. Все targetSupplierCode сохранены; фиктивных товаров нет. Дубли по identities: 0. Хеши всех полей Product/Brand/Category/ProductBarcode сохранились.

Первый references-run: SUCCEEDED. Повтор с обратным порядком ZIP: SKIPPED, created/updated=0 для всех слоёв, хеши references и ImportIssue не изменились. ImportRun=4, ImportFile=8.

66 tests passed, 0 failed, 0 skipped; полный сценарий base → EAN → references → repeat.

## Исходный аудит (взяты ранее полученные результаты, повторный проход не запускался)

Images: 141826 товаров с изображениями, 7046 без; 391523 записи, 18 дублей, 391484 уникальных URL, 21 общий URL разных товаров; максимум 31. Все ссылки абсолютные, пустых/пробелов нет. Расширения: jpeg 252114, jpg 112881, png 26495, gif 31, webp 2. Описаний и отдельных image-ID в XML нет.

Documents: 134244 товара с документами, 14628 без; 321244 записи, 47 дублей, 25097 уникальных references, 8376 общих references разных товаров, максимум 31. Типы: certificate 175113, catalog 56147, passport 34805, video 55179. 30 не абсолютных/сомнительных references, 1839 с крайними пробелами, 211 с внутренними, 32827 с Unicode; пустых нет. Расширения: pdf 262877, без расширения 55047, jpg 2691, php 573, doc 34, jpeg 12, png 5, docx 2, tiff/gpg/pd по 1. Дополнительных названий документов в XML нет.

Relations: 519990 записей; analog 79289, related 440701. 54051 исходный товар, 58769 существующих товаров участвуют с обеих сторон. Максимум 1154 связи у товара. Self/duplicates=0. 69055 уникальных targets: 36832 существуют, 32223 отсутствуют. 96914 направленных записей имеют обратную связь того же типа (48457 пар); автоматически обратные связи не добавляются.

## Время и выборочный peak RSS Node.js

| stage | seconds | rssMiB |
| --- | --- | --- |
| base | 70.64 | 479.8 |
| ean | 49.47 | 671.6 |
| first | 71.56 | 886.2 |
| second | 47.26 | 907.9 |

References требуют примерно на 32% больше RSS, чем EAN в этом прогоне. Все этапы выполнялись в одном процессе; RSS включает ранее выделенную память и не включает PostgreSQL. Это выборочный максимум, не гарантированный предел.

## ImportIssue

| severity | code | count |
| --- | --- | --- |
| WARNING | BARCODE_CHECKSUM | 300 |
| WARNING | BARCODE_WHITESPACE | 2 |
| WARNING | REFERENCE_DUPLICATE | 65 |
| WARNING | REFERENCE_EXTENSION | 2 |
| WARNING | REFERENCE_URL | 30 |
| WARNING | REFERENCE_URL_WHITESPACE | 211 |
| WARNING | REFERENCE_WHITESPACE | 1839 |
| WARNING | RELATION_UNRESOLVED | 191545 |

Новый слой добавил 193692 WARNING. Вместе с 302 EAN warnings — 193994. ERROR=0.

### Сомнительные references сохранены без исправления

| supplierCode | code | raw | stored |
| --- | --- | --- | --- |
| 269963 | REFERENCE_URL | пырвпа | пырвпа |
| 329810 | REFERENCE_URL | пырвпа | пырвпа |
| 329814 | REFERENCE_URL | пырвпа | пырвпа |
| 397033 | REFERENCE_URL | пырвпа | пырвпа |
| 397034 | REFERENCE_URL | пырвпа | пырвпа |

## 10 ProductImage

| supplierCode | name | url | sortOrder | alt |
| --- | --- | --- | --- | --- |
| 1000000 | Зуммер 1-мод. 220В BRAVA бел. DKC 76851B | https://rs24.ru/ctlg/edi/DKC/768/76851B/76851B_1.jpeg | 0 | null |
| 1000003 | Выключатель инфракрасный 1-кл. 1мод. Brava 16А IP20 сл. кость DKC 75201S | https://rs24.ru/ctlg/edi/DKC/752/75201S/75201S_1.jpeg | 0 | null |
| 1000008 | Звонок 1-мод. BRAVA 220В сл. кость DKC 75932S | https://rs24.ru/ctlg/edi/DKC/759/75932S/75932S_1.jpeg | 0 | null |
| 1000009 | Зуммер 1-мод. 12В BRAVA сл. кость DKC 75861S | https://rs24.ru/ctlg/edi/DKC/758/75861S/75861S_1.jpeg | 0 | null |
| 1000012 | Адаптер BRAVA для инф. разъемов Systimax сл. кость DKC 75609S | https://rs24.ru/ctlg/edi/DKC/756/75609S/75609S_1.jpeg | 0 | null |
| 1000013 | Выключатель 1-кл. 2п 1мод. Brava 16А IP20 с подсветкой сл. кость DKC 75121SL | https://rs24.ru/ctlg/edi/DKC/751/75121SL/75121SL_1.jpeg | 0 | null |
| 1000037 | Розетка компьютерная СП 2мод. Brava RJ45 кат.5E сл. кость DKC 75643S | https://rs24.ru/ctlg/edi/DKC/756/75643S/75643S_1.jpeg | 0 | null |
| 1000040 | Розетка компьютерная СП 2мод. Brava RJ45 кат.5E сл. кость DKC 75642S | https://rs24.ru/ctlg/edi/DKC/756/75642S/75642S_1.jpeg | 0 | null |
| 1000045 | Каркас 1-м 2мод. Brava без лапок черн. DKC 75023N | https://rs24.ru/ctlg/edi/DKC/750/75023N/75023N_1.png | 0 | null |
| 1000049 | Зуммер 1-мод. 220В BRAVA черн. DKC 77851N | https://rs24.ru/ctlg/edi/DKC/778/77851N/77851N_1.jpeg | 0 | null |

## 10 ProductDocument

| supplierCode | type | certificateType | url | name | sortOrder |
| --- | --- | --- | --- | --- | --- |
| 1000000 | catalog | null | https://rs24.ru/ecatalog/dks/катSistema_elektroustanovochnykh_izdeliy_Brava.pdf | null | 1 |
| 1000000 | certificate | Декларация ЕАЭС | http://sert.russvet.ru/EAES_N_RU_D-IT.PA02.V.97581_21.pdf | null | 0 |
| 1000000 | video | null | https://rutube.ru/video/04ab60a9fc9841e66859f627c7cf130a/ | null | 2 |
| 1000003 | certificate | Сертификат ЕАЭС | http://sert.russvet.ru/RU_C-RU.NV26.V.04979_24.pdf | null | 0 |
| 1000003 | video | null | https://www.youtube.com/watch?v=k4Cz8hwWPCY | null | 1 |
| 1000008 | catalog | null | https://rs24.ru/ecatalog/dks/катSistema_elektroustanovochnykh_izdeliy_Brava.pdf | null | 1 |
| 1000008 | certificate | Декларация ЕАЭС | http://sert.russvet.ru/EAES_N_RU_D-IT.PA02.V.97581_21.pdf | null | 0 |
| 1000008 | video | null | https://rutube.ru/video/04ab60a9fc9841e66859f627c7cf130a/ | null | 2 |
| 1000009 | catalog | null | https://rs24.ru/ecatalog/dks/катSistema_elektroustanovochnykh_izdeliy_Brava.pdf | null | 1 |
| 1000009 | certificate | Декларация ЕАЭС | http://sert.russvet.ru/EAES_N_RU_D-IT.PA02.V.97581_21.pdf | null | 0 |

## 20 ProductRelation (10 unresolved + 10 resolved)

| supplierCode | name | relationType | targetSupplierCode | relatedId | targetName |
| --- | --- | --- | --- | --- | --- |
| 1000000 | Зуммер 1-мод. 220В BRAVA бел. DKC 76851B | related | 1005900 | null | null |
| 1000000 | Зуммер 1-мод. 220В BRAVA бел. DKC 76851B | related | 1005901 | null | null |
| 1000000 | Зуммер 1-мод. 220В BRAVA бел. DKC 76851B | related | 1005902 | null | null |
| 1000000 | Зуммер 1-мод. 220В BRAVA бел. DKC 76851B | related | 1005903 | null | null |
| 1000000 | Зуммер 1-мод. 220В BRAVA бел. DKC 76851B | related | 1005904 | null | null |
| 1000000 | Зуммер 1-мод. 220В BRAVA бел. DKC 76851B | related | 1005926 | null | null |
| 1000000 | Зуммер 1-мод. 220В BRAVA бел. DKC 76851B | related | 1005929 | null | null |
| 1000000 | Зуммер 1-мод. 220В BRAVA бел. DKC 76851B | related | 1005930 | null | null |
| 1000000 | Зуммер 1-мод. 220В BRAVA бел. DKC 76851B | related | 1005931 | null | null |
| 1000000 | Зуммер 1-мод. 220В BRAVA бел. DKC 76851B | related | 1005932 | null | null |
| 1000000 | Зуммер 1-мод. 220В BRAVA бел. DKC 76851B | related | 1005928 | 1156 | Угол внутренний для кабель-канала 22х10 AIM корич. DKC 00386B |
| 1000000 | Зуммер 1-мод. 220В BRAVA бел. DKC 76851B | related | 1005936 | 1157 | Угол внешний для кабель-канала 22х10 AEM корич. DKC 00396B |
| 1000000 | Зуммер 1-мод. 220В BRAVA бел. DKC 76851B | related | 1005952 | 1158 | Тройник для кабель-канала IM 22х10 корич. DKC 00525B |
| 1000000 | Зуммер 1-мод. 220В BRAVA бел. DKC 76851B | related | 1005961 | 1159 | Заглушка для кабель-канала LM 22х10 корич. DKC 00580B |
| 1000000 | Зуммер 1-мод. 220В BRAVA бел. DKC 76851B | related | 1005966 | 1160 | Соединение на стык для кабель-канала GM 40х17 корич. DKC 00597B |
| 1000000 | Зуммер 1-мод. 220В BRAVA бел. DKC 76851B | related | 10286 | 2243 | Заглушка для кабель-канала LAN 100х40 DKC 00873 |
| 1000000 | Зуммер 1-мод. 220В BRAVA бел. DKC 76851B | related | 105568 | 2709 | Рамка-суппорт 6мод. PDA-3BN 80 под Brava DKC 10643 |
| 1000000 | Зуммер 1-мод. 220В BRAVA бел. DKC 76851B | related | 10857 | 3443 | Кабель-канал 25х30 L2000 пластик TA-EN DKC 00323 |
| 1000000 | Зуммер 1-мод. 220В BRAVA бел. DKC 76851B | related | 123495 | 9668 | Соединение для кабель-канала боков. SGAN 60 DKC 00833 |
| 1000000 | Зуммер 1-мод. 220В BRAVA бел. DKC 76851B | related | 125462 | 12522 | Рамка-суппорт 6мод. PDA-3BN 100 под Brava DKC 10653 |

## ImportRun

| id | status | processedRecords | createdRecords | updatedRecords | skippedRecords | failedRecords | errorCount | warningCount |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | SUCCEEDED | 148882 | 148872 | 0 | 10 | 0 | 0 | 0 |
| 2 | SUCCEEDED | 148882 | 0 | 0 | 148882 | 0 | 0 | 302 |
| 3 | SUCCEEDED | 148882 | 0 | 0 | 148882 | 0 | 0 | 193692 |
| 4 | SKIPPED | 148882 | 0 | 0 | 148882 | 0 | 0 | 0 |

## Неизменившиеся хеши таблиц после повторного запуска

| table | hash |
| --- | --- |
| products | f8e3892d1d3557eb8027a78855ab3771 |
| brands | fc5d9656b7c6210774a68802fa61aacb |
| categories | 2c7a9001874e33ba4acfa7925ca953fe |
| product_barcodes | 321e158ad038f4cc8cb649c8cb1b69b5 |
| product_images | 12bb93e928a92aa564783739cb4b02e2 |
| product_documents | dee3299399bf1dda3daf3d7355dcd08d |
| product_relations | 9a73011b40a5ac2c6a788aa212c92b29 |
| import_issues | f3307e7e2ec9bbe5248450303704f97b |
