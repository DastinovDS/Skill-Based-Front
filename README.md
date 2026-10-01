# Skill-Based Front

Соревновательная стратегия 1v1 в браузере, партия от 10 до 15 минут. Карта: граф городов и дорог.
Юнит работает как «батарейка»: заряжен или разряжен. Столица производит заряды, дороги их развозят,
юнит без заряда беззащитен.

Архитектура: авторитарный сервер на Python (FastAPI), чистая детерминированная симуляция,
туман войны на сервере, веб-клиент на TypeScript (Svelte 5 + PixiJS 8).

## Документы

- [`docs/design/mechanics.md`](docs/design/mechanics.md): правила игры, единственный источник правды о механике.
- [`AGENTS.md`](AGENTS.md): обязательные правила для агентов и разработчиков (структура, команды, детерминизм, процесс).
  `CLAUDE.md` подключает его для Claude Code.
- [`docs/mvp/MVP_PLAN.md`](docs/mvp/MVP_PLAN.md): план MVP (вехи, оценки, риски);
  [`docs/mvp/MVP_ISSUES.md`](docs/mvp/MVP_ISSUES.md): все issues плана; `docs/mvp/issue_map.json`: ID → номер issue.
- [`docs/adr/`](docs/adr/): архитектурные решения, начиная с [`0001-architecture.md`](docs/adr/0001-architecture.md).
- [`docs/design/archive/DESIGN-v1.md`](docs/design/archive/DESIGN-v1.md): первая версия дизайн-документа (устарела).

## Структура репозитория

```
packages/sim/        gow_sim       правила игры: чистая детерминированная симуляция
packages/protocol/   gow_protocol  Pydantic-модели сообщений клиент <-> сервер, фикстуры, тест-векторы
apps/server/         gow_server    FastAPI: HTTP (лобби, рейтинг) + WebSocket (матчи)
apps/bots/           gow_bots      боты и турнирный харнесс
apps/client/                       веб-клиент: TypeScript + Vite + Svelte 5 + PixiJS 8
tools/maps/          gow_maps      офлайн-инструменты для карт: валидатор, отзеркаливание, превью
maps/                              карты MVP (JSON, превью)
rulesets/                          наборы правил (*.toml) и архив сыгранных по хэшу
docs/design/                       механика, формат карты, архив старого дизайна
docs/adr/                          архитектурные решения
docs/balance/                      отчёты баланса
docs/mvp/                          план MVP и список issues
docs/qa/                           чек-листы
deploy/                            Dockerfile-ы, Caddyfile, скрипты развёртывания (compose.yaml в корне)
```

Python-пакеты собраны в uv workspace (корневой `pyproject.toml`), у каждого src-layout:
`<каталог>/src/<пакет>/__init__.py`. Версия Python зафиксирована в `.python-version` (3.12).

## Быстрый старт

Нужен [uv](https://docs.astral.sh/uv/).

```sh
uv sync --locked
uv run python -c "import gow_sim, gow_protocol, gow_server, gow_bots, gow_maps"
```

Если Python 3.12 не установлен: `uv python install 3.12`.

Проверки Python-кода (полный список команд: `AGENTS.md`, раздел 3):

```sh
uv run ruff check . && uv run ruff format --check .
uv run pyright
uv run lint-imports
uv run pytest               # в CI: HYPOTHESIS_PROFILE=ci uv run pytest
uv run pre-commit install   # один раз: ruff перед каждым коммитом
```

Клиент: нужны Node.js 24.15+ и pnpm (версия зафиксирована в `apps/client/package.json`, поле `packageManager`;
`corepack enable pnpm` или `npm i -g pnpm`).

```sh
pnpm -C apps/client install --frozen-lockfile
pnpm -C apps/client dev                              # http://localhost:5173
pnpm -C apps/client build && pnpm -C apps/client preview   # прод-сборка под целевым CSP
```

Типы протокола в клиенте (`apps/client/src/protocol.gen.ts`) генерируются из Pydantic-моделей
`gow_protocol`, руками не правятся. После изменения моделей:

```sh
uv run python scripts/export_schema.py && pnpm -C apps/client gen:protocol
```

Dev-экран клиента показывает карту из бандла (`maps/*.json`, до MAP-04 тестовые карты
`packages/sim/tests/maps/`): выбор карты и «Вписать карту» в панели, перетаскивание сдвигает карту,
колесо меняет масштаб у курсора. Счётчик FPS в панели обновляется дважды в секунду.

Языки интерфейса: русский и английский. При первом визите язык берётся из настроек браузера
(`navigator.languages`: первый из `ru`/`en`, для остальных языков английский), переключатель «Язык» в панели
меняет его и запоминает выбор в `localStorage` (ключ `sbf.locale`; если хранилище недоступно, выбор
действует до перезагрузки). Строки интерфейса лежат в `apps/client/src/i18n/ru.ts` и `en.ts`: отсутствующий
или лишний ключ в `en.ts` — ошибка типов, а `pnpm -C apps/client check:i18n` проверяет, что в разметке
нет строк мимо словарей и что наборы ключей совпадают (входит в `pnpm -C apps/client test`).

## CI

GitHub Actions, `.github/workflows/ci.yml`. Запускается на PR в `develop` и `main`, на push в `develop`
и вручную (`workflow_dispatch`).

**Обязательные проверки** (PR мержится только когда все зелёные):

| Проверка | Что делает |
|---|---|
| `py` | `uv sync --locked`, `ruff check`, `ruff format --check`, `pyright`, `lint-imports`, `pytest` с `HYPOTHESIS_PROFILE=ci` |
| `web` | `pnpm -C apps/client install --frozen-lockfile`, шаг `protocol-drift` (перегенерация схемы протокола и `protocol.gen.ts`, падает при отличии от закоммиченных), `lint`, `check`, `test`, `build` |
| `docker` | `hadolint` для `deploy/*.Dockerfile`, затем `deploy/smoke.sh`: сборка образов, `docker compose up`, проверки через Caddy |

- Вспомогательный job `changes` смотрит на изменённые пути в PR. Если в PR нет изменений для `py`, `web` или `docker`
  (например, правка только документации), соответствующий job пропускается, а GitHub считает пропущенный job
  успешным: обязательная проверка не зависает в ожидании. Если сам `changes` упал, все проверки запускаются целиком.
  На push в `develop` и при ручном запуске проверяется всё.
- Версии: Python из `.python-version`, pnpm из поля `packageManager`, Node из поля `engines.node`
  в `apps/client/package.json`.

**Branch protection не включена.** Для приватного репозитория на бесплатном плане GitHub API отвечает
`403 Upgrade to GitHub Pro or make this repository public to enable this feature` (и для branch protection,
и для rulesets). Пока это так, правило «мерж только при зелёных `py`, `web` и `docker`» держится на процессе (AGENTS.md, раздел 11).
После перехода на Pro или открытия репозитория: Settings → Branches → правило для `develop`
(и `main`) с обязательными проверками `py`, `web` и `docker`, без обязательных ревью, без `enforce_admins`.

## Сервер

```sh
uv run gow-server            # http://127.0.0.1:8000/api/health
uv run gow-server --reload   # перезапуск при изменении кода
```

Сервер всегда запускается с одним воркером (`AGENTS.md`, раздел 5.1). Логи: JSON-строки в stderr,
у каждого запроса `request_id` (заголовок `X-Request-ID`). Настройки: переменные окружения `GOW_*`
(`apps/server/src/gow_server/settings.py`):

| Переменная | По умолчанию | Значение |
|---|---|---|
| `GOW_ENV` | `dev` | `dev`, `e2e` или `prod` |
| `GOW_HOST`, `GOW_PORT` | `127.0.0.1`, `8000` | адрес сервера |
| `GOW_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `GOW_FORWARDED_ALLOW_IPS` | `127.0.0.1` | прокси (Caddy), которому доверяются заголовки `X-Forwarded-*` |
| `GOW_MAPS_DIR` | `maps` | пул карт: `<id>.json` и необязательный фон `<id>.bg.png` |
| `GOW_RULESET_PATH` | `rulesets/mvp-0.toml` | набор правил матчей, которые запускает сервер |
| `GOW_DATABASE_URL` | `sqlite:///data/gow.db` | база SQLite (WAL); путь относительно рабочего каталога |
| `GOW_GUEST_RATE_LIMIT`, `GOW_GUEST_RATE_WINDOW_S` | `10`, `3600` | не больше N новых гостей с одного IP за окно в секундах |
| `GOW_INVITE_TTL_S` | `1800` | срок жизни приглашения в приватный матч (секунды) |
| `GOW_WS_ALLOWED_ORIGINS` | `[]` | JSON-список `Origin`, кроме собственного сайта, которым можно открывать WebSocket матча |
| `GOW_WS_HELLO_TIMEOUT_S`, `GOW_WS_SEND_TIMEOUT_S` | `5`, `5` | ожидание `hello`; отправка дольше этого: клиент не читает, отключение |
| `GOW_WS_MSG_RATE`, `GOW_WS_MSG_BURST` | `20`, `60` | token bucket сообщений одного соединения (в секунду, пачка); больше: флуд, отключение |

База: SQLite, модели в `gow_server/models.py`, миграции Alembic в `gow_server/migrations/versions/`.
Сервер применяет миграции при старте; вручную: `uv run alembic -c apps/server/alembic.ini upgrade head`.
Изменение схемы: поправить модели, затем
`uv run alembic -c apps/server/alembic.ini revision --autogenerate -m "<что>"` и проверить файл миграции.

HTTP API: `GET /api/health`, `GET /api/maps` (список), `GET /api/maps/{id}` (файл карты),
`GET /api/maps/{id}/background.png` (фон, если есть). Схема: `/docs` на запущенном сервере.

WebSocket матча: `/ws/match/{id}` (`gow_server/ws.py`, AGENTS.md, раздел 5.3). `Origin` должен быть
собственным сайтом (`Host`) или из `GOW_WS_ALLOWED_ORIGINS`, иначе 403. Первое сообщение `hello` с
гостевым токеном. Коды закрытия: 4001 другая версия протокола, 4004 нет матча (или токен чужой,
неизвестный), 4009 тот же игрок открыл новое соединение, 1008 нет `hello`, флуд или клиент не читает,
1000 после `match_end`.

Гостевая идентичность (ID-01):

- `POST /api/guest` с телом `{"nick": "..."}` → `201 {"player_id", "token"}`. Токен показывается один раз,
  в базе только его SHA-256. `409`: ник занят, `422`: ник не прошёл проверку, `429`: лимит гостей с IP.
- Запросы от имени игрока: заголовок `Authorization: Bearer <token>` (пример: `GET /api/me`).
  Токен в URL не принимается и в логи не пишется. Нет токена или он неверный: `401`.
- Ник: 3–16 символов после нормализации NFC; буквы любого алфавита, цифры, `_` и `-`. Пробелы, знаки,
  эмодзи и «пустые» буквы-заполнители запрещены. Уникальность без учёта регистра: колонка
  `nick_key = nick.casefold()` с уникальным индексом (`Straße` и `STRASSE` считаются одним ником).
  Клиент показывает ник только как текст (`AGENTS.md`, раздел 7.4).

## Docker

Прод-стек: `compose.yaml` в корне, образы в `deploy/`. Нужен Docker с Compose v2.

```sh
cp .env.example .env              # необязательно: без .env игра поднимается на http://localhost
docker compose up --build -d      # http://localhost, http://localhost/api/health
deploy/smoke.sh                   # сборка, запуск и проверка стека (то же делает CI job `docker`)
deploy/check-caddy.sh             # только заголовки, кэш и маршруты уже запущенного стека
docker compose logs -f app        # логи сервера (JSON-строки)
docker compose down               # остановить; данные остаются в томах
```

| Сервис | Образ | Что делает |
|---|---|---|
| `caddy` | `deploy/caddy.Dockerfile`: сборка клиента (Node, pnpm `--frozen-lockfile`) и Caddy со статикой | единственный публичный сервис (80/443): отдаёт клиент, `/api/*` и `/ws/*` проксирует в `app` |
| `app` | `deploy/app.Dockerfile`: uv (`uv sync --locked --no-dev`), только пакеты, нужные `gow-server` | сервер, один воркер uvicorn; порт 8000 только во внутренней сети |

- **Данные:** том `gow-data` смонтирован в `/data` контейнера `app`: SQLite (`/data/gow.db` с файлами WAL)
  и реплеи (`/data/replays/`). Миграции сервер применяет при старте. Всё, что сервер пишет на диск, должно
  лежать в `/data`: корневая файловая система контейнера только для чтения. `/app/data` ведёт в `/data`,
  поэтому настройки с путём по умолчанию относительно рабочего каталога (`data/...`) тоже попадают в том.
  Тома `caddy-data` (TLS-сертификаты, ACME-аккаунт) и `caddy-config` не удаляйте без нужды.
  `docker compose down --volumes` удаляет базу.
- **Сеть:** `app` подключён только к сети `internal` без выхода наружу, на хост его порт не публикуется.
  Поэтому `GOW_FORWARDED_ALLOW_IPS=*`: заголовки `X-Forwarded-*` приходят только от Caddy, а Caddy заменяет
  присланный клиентом `X-Forwarded-For` настоящим адресом.
- **Безопасность:** оба контейнера работают не от root (uid 10001 `app`, uid 10002 `caddy`), с `cap_drop: ALL`
  и `no-new-privileges`. Caddy слушает 80/443 без `CAP_NET_BIND_SERVICE` благодаря
  `net.ipv4.ip_unprivileged_port_start=0` в `compose.yaml`.
- **Базовые образы** закреплены версией и digest в `deploy/*.Dockerfile`; как обновить, написано там же.

Переменные (`.env`, образец `.env.example`):

| Переменная | По умолчанию | Значение |
|---|---|---|
| `SITE_ADDRESS` | `http://localhost` | адрес сайта для Caddy: `http://localhost` без TLS (локально, e2e), `https://localhost` с локальным TLS, доменное имя включает автоматический HTTPS (раздел «Caddy») |
| `HTTP_PORT`, `HTTPS_PORT` | `80`, `443` | порты на хосте, например `HTTP_PORT=8080`, если 80 занят |
| `GOW_ENV`, `GOW_LOG_LEVEL`, `GOW_GUEST_RATE_LIMIT`, `GOW_GUEST_RATE_WINDOW_S` | `prod`, `INFO`, `10`, `3600` | настройки сервера (раздел «Сервер»); `e2e` только для прогона Playwright |

В `app` попадают только переменные, перечисленные в `compose.yaml` (`Settings` запрещает неизвестные поля):
новая настройка сервера для прода добавляется и туда, и в `.env.example`.

### Caddy

`deploy/Caddyfile` (OPS-02, #81):

| Путь | Что делает | Кэш |
|---|---|---|
| `/api/*` | прокси в `app:8000`, сжатие | заголовки сервера |
| `/ws/*` | прокси WebSocket в `app:8000`; при `caddy reload` открытые соединения живут ещё до 15 минут (`stream_close_delay`, партия длится 12) | — |
| `/assets/*` | файлы сборки Vite с хэшем в имени, сжатие zstd/gzip; нет файла — 404 | `public, max-age=31536000, immutable` |
| остальное | `index.html` и файлы из `apps/client/public`; неизвестный путь отдаёт `index.html` (`try_files`) | `no-cache` (проверка по ETag при каждой загрузке) |

- **Заголовки на всех ответах:** `Content-Security-Policy` из `apps/client/csp.ts` (включая `frame-ancestors 'none'`),
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (камера, микрофон,
  геолокация, платежи, USB выключены). CSP не копируется руками: образ `caddy` генерирует `/etc/caddy/csp.caddy`
  из `csp.ts` при сборке, а `deploy/check-caddy.sh` сравнивает отданный заголовок с `csp.ts`.
- **TLS:** с доменом в `SITE_ADDRESS` Caddy сам получает и продлевает сертификат Let's Encrypt (тома `caddy-data`)
  и перенаправляет HTTP на HTTPS. `Strict-Transport-Security: max-age=31536000` отправляется только по HTTPS и
  никогда для `localhost`/`127.0.0.1` (иначе браузер начнёт требовать HTTPS от всех локальных проектов).
- **Локальный TLS:** `SITE_ADDRESS=https://localhost` включает внутренний CA Caddy (браузер предупреждает о
  самоподписанном сертификате, в хранилище доверия он не ставится). Если 80/443 заняты:
  `SITE_ADDRESS=https://localhost HTTP_PORT=8080 HTTPS_PORT=8443 docker compose up -d`, затем
  `BASE_URL=https://localhost:8443 deploy/check-caddy.sh`. Перенаправление с HTTP ведёт на порт 443.
- **Проверки:** `deploy/check-caddy.sh` (заголовки, кэш, сжатие, маршруты; только чтение, годится и для прода:
  `BASE_URL=https://game.example.com`) и `deploy/check-ws-reload.sh` (WebSocket матча `/ws/match/...`
  переживает `caddy reload`: после перезагрузки сервер отвечает на том же соединении кодом 4001 на `hello`
  старой версии; матч и гость не нужны, но скрипт перезагружает Caddy через `docker compose exec`).

### Сервер, деплой и бэкапы

Подготовка VPS, первый деплой, откат, бэкапы и восстановление: `docs/ops/deploy.md` (OPS-03, #82).

```sh
deploy/deploy.sh origin/main      # на сервере: сборка, бэкап predeploy, запуск по healthcheck, откат при сбое
deploy/backup.sh                  # онлайн-бэкап тома gow-data в $BACKUP_DIR (по умолчанию ./backups)
deploy/restore.sh <archive>       # восстановление (останавливает app)
HTTP_PORT=8080 HTTPS_PORT=8443 deploy/deploy-test.sh   # локально: деплой, откат, бэкап и восстановление
```

Что добавят следующие issues: осушение матчей при деплое (после SRV-02, #47); метрики и оповещения
(OPS-04, #83); e2e Playwright против этого стека (QA-02, #84).

## Прототип на Pygame

Первый прототип (старый дизайн: пять ресурсов, здания, три типа юнитов, бой через урон и броню) в
рабочем дереве больше не лежит. Он сохранён в теге `v0-pygame-prototype` этого репозитория
(`git show v0-pygame-prototype --stat`, `git checkout v0-pygame-prototype`) и в репозитории
`DastinovDS/Game-of-War`. В новой симуляции этот код не переиспользуется; формулы генератора карт
перенесены в `tools/maps/src/gow_maps/bake.py` (MAP-05).

Первая версия дизайн-документа Skill-Based Front лежит в `docs/design/archive/DESIGN-v1.md`
(в репозитории прототипа файл не отслеживался git и скопирован из рабочей копии отдельно).
