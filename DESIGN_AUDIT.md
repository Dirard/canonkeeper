# Аудит соответствия кода макетам `.pen`

> Источник истины: `design/canonkeeper.pen` (через Pencil MCP).
> Документация `.supergoal/**` и моки/openapi **не** считаются истиной.
> Дата начала: 2026-06-16.

## Метод

- Геометрия и цвета извлекаются напрямую из `.pen` (`batch_get`, `snapshot_layout`, `get_variables`).
- Для каждой поверхности сверяются: shell-геометрия, токены, цвета компонентов, типографика, состояния, адаптив.
- Severity: **P1** — заметное визуальное расхождение / отсутствующий элемент; **P2** — неточный цвет/размер; **P3** — консистентность/поддерживаемость.

## Канонические переменные `.pen` (get_variables)

Темы: `Mode: [Light, Dark]`. Все frozen-фреймы используют `Mode: Light`.

Ключевые цвета: primary `#4F46E5`, background `#FBFBFA`, card `#FFFFFF`, sidebar `#F5F5F4`,
sidebar-accent `#EAEAE8`, reader-pane `#F7F7F6`, reader-foreground `#1F2933`,
border `#E7E7E4`, border-strong `#DADAD6`, foreground `#18181B`, foreground-strong `#111114`,
muted `#F2F3F0` (Dark `#2E2E2E`), muted-foreground `#6B7280`, subtle-foreground `#9CA3AF`,
secondary `#F1F1EF`, user-bubble `#F3F3F1`, citation `#EEF2FF` / citation-fg `#4F46E5`,
source-active `#EEF0FB`, highlight `#FEF3C7`, indexing `#FDF1D6` / `#8A6A0A`,
success `#DCFCE7` / `#15803D`, warning `#FEF3C7` / `#92740E`, error `#FEE2E2` / `#B91C1C`,
ink `#18181B`. Радиусы: xs6 sm8 md10 lg14 m16 pill999. Шрифты: Inter / Source Serif 4 / JetBrains Mono.

---

## Сводная таблица находок

| # | Severity | Экран/слой | Находка | Канон (.pen) | В коде |
|---|----------|------------|---------|--------------|--------|
| 1 | P3 | tokens.css | Слой токенов неполный (~20 из ~70 переменных). Многие цвета захардкожены или живут только в inline-fallback `var(--ck-x, #hex)` | полный набор переменных + тема Dark | tokens.css: 20 переменных, нет citation/secondary/subtle-foreground/sidebar-accent/user-bubble/color-* и темы Dark |
| 2 | P2 | Chat | Цвет «пузыря пользователя» | `#F3F3F1` (`--user-bubble`, компонент K5Ahz) | `.userBubble { background: #f0f0ef }` |
| 3 | P2 | Chat | Фон чипа-цитаты (source label) | `#EEF2FF` (`--citation`, VGJfT) | `.sourceLabel { background: #eef0ff }` |
| 4 | P2 | Chat | Размер текста цитаты в Source Card | Source Serif 4 **15px**, цвет `#1F2933` (NK1Ju/Quote) | `.sourceQuote { font-size: 17px }` |
| 5 | P2 | Chat | Рамка Source Card в обычном состоянии | полная рамка `#DADAD6` + левый аккцент `#4F46E5` 3px (NK1Ju) | `.sourceCard` только левый бордер primary, без рамки #DADAD6 |
| 6 | P1 | Reader | Темы чтения: отсутствует тёмная тема и неверный сепия | 3 кружка: Light `#FFFFFF`, Sepia `#F4ECD8`, Dark `#2E2E2E` (PexYB/Theme Row) | только 2: light `#ffffff` + paper `#fff7e8`; нет Dark; сепия #fff7e8 ≠ #F4ECD8 |
| 7 | P2 | Manuscript | Цвета статус-бейджей расходятся с каноном | success `#DCFCE7`/`#15803D`, warning `#FEF3C7`/`#92740E`, indexing `#FDF1D6`/`#8A6A0A` | statusReady `#d8f8df`/`#087a2e`, statusDraft `#f8edbf`/`#8a6500`, statusIndexing `#f4e6b9`/`#8a6500` |
| 8 | P3 | Reader CSS | Мёртвый CSS `.readerGrid` (grid 1fr/318px, max-width 1280) не используется в ReaderPage.tsx | — | определён, но не применяется |
| 9 | P3 | Chat | Кнопка «Открыть» использует текстовую стрелку `↗` вместо иконки | lucide `arrow-up-right` `#4F46E5` (NK1Ju/Open) | `Открыть ↗` (текст) |
| 10 | P3 | Manuscript | Заголовок страницы | Source Serif **26**/600 (Kr4VL/Title) | `.titleBlock h1 { font-size: 28px }` |
| 11 | P2 | Manuscript | Обложка и мета карточки книги | Cover Title Source Serif **17/600**; Meta JetBrains Mono **11** `#9CA3AF` (h2G0rW) | cover `18px/800`; meta `12px` `#6B7280` |
| 12 | P3 | Manuscript | Кебаб-кнопка на обложке | `28×28`, fill `#00000040` (~25%) | `32×32`, `rgb(17 24 39 / 50%)` |
| 13 | P3 | Sidebar | letterSpacing мета-лейбла | `1` (mono 10, Frs5F) | `.sectionLabel { letter-spacing: 0 }` в Chat/Manuscript (в Reader/Draft/Agent = 1px ✓) |
| 14 | P3 | Top Bar | Цвет бренда | `#111114` (foreground-strong, CKGYy/Brand) | Chat/Manuscript `.brand` без цвета → наследует `#18181B` |
| 15 | P2 | Sidebar | Заголовок «Чаты проекта» | Inter **14/600** `#18181B` (Frs5F/Chats Header) | стилизован как mono-10 caps `.sectionLabel` (как «Рабочая область») |
| 16 | P3 | Sidebar | Иконки навигации | `layout-dashboard` / `book-open` / `notebook-pen` (Frs5F) | `Grid2X2` / `Library` / `Pencil` |

> Подтверждено в разметке (не мёртвый CSS): #2 (ChatPage.tsx:838), #3/#4/#5 (ChatPage.tsx:730-737, 869-880), #7 (ManuscriptPage.tsx:690-697), #15/#16 (ChatPage.tsx:775-799).

---

## Чеклист по экранам

### Auth — Вход/Регистрация (B8Hox / GlCyZ)  ✅ соответствует
- [x] Brand panel 560, fill `#1E1B4B`, padding 48, space-between — OK
- [x] Логотип Source Serif 20/600 + feather 22 — OK
- [x] Питч Source Serif 30/500 lh1.25; капс mono 11 `#A5A3CF` — OK (P3: letterSpacing 1 в макете, 0 в коде)
- [x] Форма 360, gap 18; заголовок 24/600 `#111114`; саб 14 `#6B7280` — OK
- [x] Инпуты h40, кнопки h37; «или»-разделитель; Google (outline) — OK
- [x] Footer-переключатель режимов по центру — OK
- Примечание: капс «ПАМЯТЬ ВАШЕЙ САГИ» letterSpacing 1 (макет) vs 0 (код) — P3.

### Chat (StB6I / y2wCzb / mobile)  ⚠️ мелкие цветовые расхождения
- [x] Shell: topbar 64, columns 276 / 1fr / reader 480 — OK
- [x] Header 62, thread измеряется 600, composer 600×60, composer footer 96 — OK
- [ ] Пузырь пользователя `#F3F3F1` — **#2**
- [ ] Чип цитаты `#EEF2FF` — **#3**
- [ ] Цитата Source Card 15px + рамка `#DADAD6` — **#4, #5**

### Reader (wUPWH и варианты)  ⚠️ отсутствует тёмная тема
- [x] Shell: 276 / 824 / rightRail 340; readerTop 44+84 — OK
- [ ] Reading Settings: 3 темы (Light/Sepia/Dark) — **#6**
- [x] Stepper размера текста (28/40/28, fill #F1F1EF) — OK
- [ ] Мёртвый CSS `.readerGrid` — **#8**

### Draft (BKEvY / kEE7B)  ✅ соответствует
- [x] Shell: 276 / 1fr / 340; editor rows 44/84/48/1fr/60; measure 660 — OK
- [x] Format toolbar (undo/redo | bold/italic | heading/quote/list | link) — OK
- [x] Темы 3 кружка (light/sepia #f4ecd8/dark #2e2e2e) — OK ✅ (контраст с Reader!)
- [x] Footer: save-status + «320 слов · 3 абзаца» + «Опубликовать» (primary, upload) — OK

### Agent IDE (yd5hn)  ✅ соответствует (эталон)
- [x] Shell: 276 / 724 / 440; editor 44/84/48/1fr/60; agent panel 37/1fr/117 — OK
- [x] Tablet 64/470/300, editor 44/109/44/1fr/56, panel 37/1fr/80 — OK
- [x] Mobile 52/1fr/111 — OK
- [x] Suggestion card min-h 277, diff `#FEE2E2`/`#B91C1C` + `#DCFCE7`/`#15803D` — OK
- [x] scope-чипы, selection context (левый бордер primary), tool pills — OK

### Manuscript (Kr4VL / ruLSC / xmF9d)  ⚠️ цвета бейджей + типографика карточки
- [x] Shell: topbar 64, sidebar 276, main x=276, padding 32, gap 24 — OK
- [x] Page Header: Title + Meta + действия «Загрузить файл» (outline/upload) + «Новая книга» (primary/plus) — OK
- [x] Grid Label «КНИГИ САГИ» mono 10 #9CA3AF — OK
- [x] Books Row gap 20, карточка 220, активная книга рамка #4F46E5 2px — OK
- [x] Dropzone «Перетащите FB2 или EPUB / …до 50 МБ» — OK
- [ ] Заголовок страницы 26px — **#10**
- [ ] Типографика обложки/меты карточки — **#11**
- [ ] Кебаб 28×28 #00000040 — **#12**
- [ ] Статус-бейджи цвета (success/warning канон) — **#7**

### Общие компоненты (Top Bar / Sidebar / Composer)
- [x] Top Bar: 64, fill #FBFBFA, padding 0/28, нижний бордер, бренд 18/600 — OK (цвет бренда — #14)
- [x] Sidebar: 276, fill #F5F5F4, padding 18, gap 14, nav-пункты Обзор/Чат/Материалы/Рукопись — OK
- [ ] Заголовок «Чаты проекта» (14/600) — **#15**
- [ ] Иконки nav (layout-dashboard/book-open/notebook-pen) — **#16**
- [ ] letterSpacing мета-лейбла в Chat/Manuscript — **#13**

### Адаптив (mobile/tablet)
- [x] Auth mobile (Bitbb): одна колонка, бренд-панель сверху — OK
- [x] Chat 52 / tablet rail 64 / mobile drawer — OK
- [x] Reader/Draft/Agent tablet 64/470/300, mobile — соответствуют контрактам
- [x] Manuscript mobile показывает 2 карточки (n+3 скрыты) — намеренная адаптация
- [ ] Reader mobile: тёмная тема (см. #6) недоступна

---

## Статус исправления (2026-06-16)

Все 16 замечаний исправлены. Глобальная тёмная тема (Mode: Dark на уровне токенов) намеренно отложена по решению по дизайну — в `tokens.css` добавлены только Light-значения.

| # | Статус | Что сделано |
|---|--------|-------------|
| 1 | ✅ | `tokens.css` дополнен полным набором канонических переменных (citation, secondary, subtle-foreground, sidebar-accent, user-bubble, success/warning/error/indexing, destructive, radius-m/pill, reader-sepia/dark). Хардкоды переведены на токены. |
| 2 | ✅ | `.userBubble` → `var(--ck-user-bubble)` (`#F3F3F1`) |
| 3 | ✅ | `.sourceLabel` → `var(--ck-citation)` / `var(--ck-citation-foreground)`, padding 2/6 |
| 4 | ✅ | `.sourceQuote` 15px + `var(--ck-reader-foreground)` |
| 5 | ✅ | Source Card: рамка `var(--ck-border-strong)` + левый аккцент primary на цитате; active = primary + source-active |
| 6 | ✅ | Reader: 3 темы Light/Sepia(`#F4ECD8`)/Dark(`#2E2E2E`), дот 22px, active-бордер primary 2px; добавлены поверхности sepia/dark |
| 7 | ✅ | Статус-бейджи рукописи → канон success/warning/indexing/error токены; убран лишний «•» |
| 8 | ✅ | Удалён мёртвый `.readerGrid` (desktop + mobile) |
| 9 | ✅ | «Открыть» → иконка `ArrowUpRight`, класс `.openLink` |
| 10 | ✅ | Заголовок рукописи 26px/600 |
| 11 | ✅ | Обложка 17/600; мета 11px `--subtle-foreground`; title 14/600; padding 12 |
| 12 | ✅ | Кебаб 28×28, `#00000040` |
| 13 | ✅ | `.sectionLabel` letterSpacing 1px (Chat/Manuscript) |
| 14 | ✅ | Бренд `var(--ck-foreground-strong)` (Chat/Manuscript) |
| 15 | ✅ | «Чаты проекта» → `.chatsTitle` Inter 14/600 |
| 16 | ✅ | Иконки nav → `LayoutDashboard` / `BookOpen` / `NotebookPen` (+ cabinet `LayoutDashboard`) |
| доп. | ✅ | Auth: letterSpacing 1px на капс-подписи бренд-панели |

Проверки: `tsc --noEmit` ✅, `eslint --max-warnings 0` ✅, `vitest` 54/54 ✅.

---

## Ре-аудит (2026-06-18)

Свежая независимая сверка `get_variables` из `.pen` с `tokens.css` выявила дрейф трёх цветов второстепенного текста: `.pen` обновлён после 2026-06-16 (более тёмные/контрастные значения), а токены отстали. Источник истины — `.pen`; токены и inline-fallback синхронизированы.

| Переменная | Канон (.pen) | Было в коде | Статус |
|---|--------------|-------------|--------|
| `--muted-foreground` | `#636B77` | `#6B7280` | ✅ |
| `--subtle-foreground` | `#767C87` | `#9CA3AF` | ✅ |
| `--sidebar-foreground` | `#636B77` | `#6B7280` | ✅ |

Дополнительно: 8 inline-fallback `var(--ck-subtle-foreground, #9CA3AF)` (Draft/RichDraftEditor) → `#767C87`; устранена ссылка на несуществующие токены `--ck-warning`/`--ck-warning-foreground` → `--ck-color-warning(-foreground)`. Остальные ~30 переменных, shell-геометрия и все 16 пунктов аудита 2026-06-16 подтверждены без регрессий. Проверки: `tsc --noEmit` ✅, `eslint --max-warnings 0` ✅, `vitest` 107/107 ✅.

---

## Живой аудит и темы чтения (2026-06-19)

Пройдены вживую (mock API + dev-сервер) все экраны/переходы/модалки: auth (login/register/placeholder/logout/protected-redirect/returnTo), полка (новая книга, кебаб, экспорт, удаление-confirm), reader (3 темы, навигация, заметки), draft (редактор, save, agent approve/reject), chat (SSE-стрим, source→reader-панель, переименование, создание, empty-state), глобальный поиск, адаптив mobile/tablet.

**Темы чтения переработаны (качество > заплатка).** Раньше тёмная/сепия в Reader и Draft перекрашивали только фон и абзацы — заголовок сливался, подсветка резала глаза. Теперь темы целостно переопределяют дизайн-токены в области чтения (`.content` в Reader; `.editor` + `.rightPane` в Draft), включая заголовки, мету, футер, навигацию, правый rail, diff-карточки агента и подсветку (мягкий тёмно-янтарный фон + тёплый текст). Топ-бар и сайдбар остаются светлым хромом.

**Синхронизация `.pen`:** в дизайн-систему добавлены переменные тем чтения (`--reader-dark-*`, `--reader-sepia-*`) и визуальная секция `FOUNDATIONS · READING THEMES` с образцами Светлая/Сепия/Тёмная (поверхность, заголовок, текст, подсветка) — тёмной темы чтения в макете раньше не было.

**Прочие фиксы:** меню действий книги центрируется при восстановлении из URL (раньше прибивалось к краю); auth-placeholder не протекает между login/register; ярлык типа результата поиска (`searchResultKindLabel`: Заметка/Канон/Материал/Глава).

---

## Режимы Чтение/Черновик и заметки (2026-06-19)

**Чтение/Черновик — один компонент, не две страницы.** Переключатель режимов больше не навигирует между страницами, а тумблит редактор между `readonly`/`wysiwyg` в одном `ManuscriptDraftMode`. В режиме чтения скрыта панель форматирования, а grid-строки редактора (`.editorReading` / `.mobileSurfaceReading`) перестроены, чтобы зона чтения растягивалась на всю доступную высоту (была видна лишь пара строк из-за пустой строки тулбара).

**Заметки восстановлены в черновике (CRUD).** После рефакторинга тумблера доступ к заметкам жил только в Reader. Возвращены добавление/редактирование/удаление прямо во вкладке «Заметки» правого rail: кнопка «Добавить заметку», карточки с действиями ✎/🗑, модалки создания/редактирования и подтверждения удаления (через `Overlay` + портал), тосты «Заметка добавлена/обновлена/удалена».

**Мобильный черновик получил доступ к панели (новый паттерн).** Раньше мобильная поверхность письма полностью теряла rail (заметки, структуру, чат проекта, настройки отображения и темы). Добавлена нижняя шторка (bottom sheet) по кнопке «Панель главы» в шапке: внутри — те же вкладки Структура/Заметки/Чат и блок «Отображение» (размер текста, тема), переиспользуя `RightPane` через `variant="sheet"` (без дублирования логики). На иконке-триггере — бейдж с числом заметок. Модалки заметок корректно наслаиваются поверх шторки. Также исправлен скрытый баг: мобильный `<main>` не выставлял `data-display-theme`, поэтому темы чтения на телефоне не применялись вовсе.

**Синхронизация `.pen` (ожидает):** новый мобильный паттерн bottom-sheet ещё не отражён на доске «Рукопись · Row · Mobile» — это отдельный дизайн-проход (кнопка-триггер в шапке + артборд шторки + flow-стрелка по конвенциям доски).

---

## Централизация сайдбара (2026-06-19)

**Был свой «старый» сайдбар на каждом экране — теперь один общий.** Сайдбар проекта дублировался четырьмя копиями (плюс три мобильных drawer-меню). Вынесён единый компонент `src/ui/ProjectSidebar` (композирует `ui/WorkspaceNav`): переключатель проекта + рабочая область + чаты проекта. Теперь его рендерят ВСЕ поверхности (библиотека, чат, чтение, черновик) и на десктопе, и внутри каждого мобильного drawer-меню (`variant="drawer"`). Метка кнопки создания чата унифицирована («Новый чат»).

**Навигация — только Рукопись + Чат.** При централизации временно подключили `WorkspaceNav` с 4 пунктами (Обзор/Чат/Материалы/Рукопись) — но Обзор и Материалы не должны быть в сайдбаре. `WorkspaceNav` оставлен с двумя пунктами; неиспользуемые обработчики `openOverview`/`openMaterialsSearch`/`navigateToOverview` и их пропсы удалены во всех вызовах.

**Слой.** `src/ui/` — это `shared` (низший слой), поэтому компонент не импортирует типы из `entities` (иначе `architecture:check` падает на upward-import); сессии принимаются через минимальную локальную форму `{ id, title }`. Десктопный rail скрывается на `≤1100px` (планшет показывает свой `.tabletRail`, у черновика — 2-колоночный grid), мобильные drawer — полноэкранные панели слева. Осиротевший CSS сайдбара удалён из всех модулей.

---

## Мобильная библиотека (2026-06-20)

**Убрана непонятная кнопка «Действия книги» из шапки.** В мобильной шапке рядом с профилем были «3 точки», открывавшие действия для «выбранной» книги (нижний лист) — без контекста это сбивало с толку. Кнопка и весь нижний лист (`BookActionSheet`) удалены; действия книги доступны там, где и должны — по `⋯` на самой карточке (якорное меню, помещается в ширину экрана).

**Карточки книг растянуты на всю ширину.** `.booksGrid` — это flex с карточками фикс. 220px, а медиазапросы задавали `grid-template-columns` (не работает при `display:flex`) — поэтому на телефоне карточки оставались узкими. На `≤700px` карточка теперь `width:100%`; также снят баг-хак `nth-of-type(n+3){display:none}`, который скрывал 3-ю и последующие книги (видно было только 2).

---

## Анимации и переходы (2026-06-20)

Раньше все оверлеи и поповеры просто «выскакивали» и мгновенно исчезали. Добавлен централизованный слой движения — без сторонних библиотек.

**Фундамент.** Motion-токены в `tokens.css` (`--ck-ease-standard|out|in`, `--ck-duration-fast|base|slow`). Глобальные `@keyframes` + правила в `base.css`, привязанные к data-атрибутам, поэтому анимируются ВСЕ поверхности без правок в каждом файле:
- `[data-overlay-scrim][data-state]` — затемнение подложки (fade);
- `[data-kind=dialog|drawer|sheet|menu|fullscreen][data-state]` — панель: scale-in (диалог), slide-left (drawer), slide-up (sheet), fade (fullscreen). **Menu — только opacity**, т.к. его панель `position:fixed`, и transform у предка сместил бы её containing-block;
- `[data-pop][data-state]` — якорные поповеры; вариант `data-pop="center"` сохраняет центрирующий `translateX(-50%)`.

**Вход И выход.** Хук `src/ui/use-presence.ts` (`usePresence`) держит условно-отрисованный узел смонтированным на время выхода и сохраняет последнее «истинное» значение (контент не мигает пустотой при закрытии). `Overlay` получил проп `state?: PresenceStatus` и проставляет `data-state`. Закрытие через Esc/крестик/выбор пункта — всё запускает анимацию выхода, т.к. идёт через один и тот же стейт.

**Тесты.** В jsdom `window.matchMedia` отсутствует → usePresence считает это (и `prefers-reduced-motion: reduce`) сигналом мгновенного размонтирования — тесты не пришлось переписывать (109 зелёных).

**Микро-взаимодействия.** Глобальные transition на hover/focus/press для button/a/input; fade-up при появлении карточек книг (+ hover-lift) и сообщений чата. Блок `prefers-reduced-motion` отключает всё это для пользователей с соответствующей настройкой.

Проверено вживую: pop/scale/slide + fade подложки, цикл open → closing (узел остаётся в DOM) → размонтирование; центрирование поиска сохраняется в покое; консоль чистая.

---

## Итог и приоритеты исправления

**Общая оценка:** реализация высокого качества; shell-геометрия и компоненты Agent/Draft/Auth — почти попиксельно. Основные расхождения — цветовые/типографические, сосредоточены в Chat (ранний код с хардкодами) и Manuscript (бейджи), плюс отсутствие тёмной темы в Reader и неполный слой токенов.

**P1 (исправить в первую очередь):**
- #6 Reader: вернуть 3 темы чтения (Light/Sepia `#F4ECD8`/Dark `#2E2E2E`), как в Draft.

**P2 (заметные цвета/размеры):**
- #2 пузырь пользователя `#F3F3F1`; #3 чип цитаты `#EEF2FF`; #4 цитата 15px;
  #5 рамка Source Card `#DADAD6`; #7 бейджи success/warning канон; #11 типографика карточки книги; #15 заголовок «Чаты проекта» 14/600.

**P3 (консистентность/поддерживаемость):**
- #1 дополнить `tokens.css` всеми каноническими переменными (+ опционально тема Dark) и перевести хардкоды на токены;
  #8 удалить мёртвый `.readerGrid`; #9 иконка стрелки; #10 заголовок 26px; #12 кебаб; #13 letterSpacing; #14 цвет бренда; #16 иконки nav.

## Заметки по ходу
- Agent/Draft реализованы наиболее точно и через токены с верными fallback.
- Chat реализован раньше и с приблизительными хардкод-цветами (#f0f0ef, #eef0ff) вместо канона — основной источник P2-расхождений.
- Reader и Draft реализуют один и тот же компонент «Reading Settings» по-разному (Reader потерял Dark-тему) — несогласованность.
- Корневая причина большинства P2/P3: неполный `tokens.css` → цвета дублируются хардкодами, расходящимися с `.pen`.
