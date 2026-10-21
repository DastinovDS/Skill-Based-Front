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
mise.toml                          версии инструментов и все команды проекта (mise)
```

Python-пакеты собраны в uv workspace (корневой `pyproject.toml`), у каждого src-layout:
`<каталог>/src/<пакет>/__init__.py`. Версия Python зафиксирована в `.python-version` (3.12).

## Быстрый старт

Команды проекта и версии инструментов задаёт [mise](https://mise.jdx.dev) (`mise.toml` в корне, список задач и их смысл:
`AGENTS.md`, раздел 3). Нужны только mise и Docker (последний для стеков и E2E); Node.js, pnpm и uv mise ставит сам.

**macOS** (Homebrew):

```sh
brew install mise
mise trust                  # один раз на клон: mise не выполняет чужой mise.toml без доверия
mise install                # node, pnpm, uv версий проекта
mise run setup              # uv sync --locked и pnpm install (клиент, e2e)
```

**Windows:** `winget install jdx.mise` (или `scoop install mise`), дальше те же `mise trust`, `mise install`,
`mise run setup` в PowerShell. Почти все задачи это обычные вызовы `uv`, `pnpm` и `docker` без bash. Исключения:
`stack`, `stack:reset`, `stack:agent` (подставляют рулсет в окружение командой `VAR=значение команда`, нужна
POSIX-оболочка) и `smoke` (запускает `deploy/smoke.sh`, нужен bash): запускай их из Git Bash. Остальное в Windows не
проверялось (нет машины), если что-то не работает, заведи issue. Активировать mise в профиле оболочки не нужно:
`mise run <задача>` подставляет нужные версии сам (для обычного терминала активация удобна: `mise activate`).

Ежедневные команды:

```sh
mise tasks                  # все задачи с описаниями
mise run check              # ruff, pyright, lint-imports, карты, lint и check клиента и e2e
mise run test               # быстрый pytest (как job py) и Vitest
mise run test:perf          # бенчмарки и tick lag, только последовательно
mise run test:slow          # длинные матчи ботов (job py-slow)
mise run dev                # сервер (порт 8000) и клиент (http://localhost:5173), Ctrl-C останавливает оба
mise run test:py -- -k combat -vv   # аргументы инструмента после --
```

Вывод задач тихий: видно только то, что печатают инструменты. Ошибки не скрываются; `mise run -o prefix <задача>`
подписывает строки задачами. Один раз после клона: `mise run hooks` (ruff перед каждым коммитом).

Без mise те же проверки запускаются напрямую (нужны [uv](https://docs.astral.sh/uv/), Node.js 24.15+ и pnpm версии из
поля `packageManager` в `apps/client/package.json`: `corepack enable pnpm` или `npm i -g pnpm`): команды лежат в
`mise.toml`, в каждой задаче одна-две строки. Если Python 3.12 не установлен, uv скачает его сам
(`uv python install 3.12`).

Типы протокола в клиенте (`apps/client/src/protocol.gen.ts`) генерируются из Pydantic-моделей
`gow_protocol`, руками не правятся. После изменения моделей: `mise run regen:protocol`.

Типы HTTP API (`apps/client/src/api.gen.ts`) генерируются из OpenAPI приложения FastAPI
(`apps/server/openapi.json`), руками не правятся. После изменения эндпоинтов или их моделей: `mise run regen:api`
(обе генерации сразу: `mise run regen`).

Прод-сборка клиента под целевым CSP: `mise run preview`.

Клиент в разработке: `mise run dev` (`uv run gow-server` на порту 8000 и `pnpm -C apps/client dev`); dev-сервер Vite
проксирует `/api` и `/ws` на `127.0.0.1:8000`. Экраны: ник гостя (токен в `localStorage`, ключ `sbf.guest`, в адрес
не попадает), меню, приватный матч (ссылка-приглашение `/?m=<код>`, код после чтения убирается из адресной
строки), матч с ботом, матч, итог с реплеем. Старый dev-экран с картой и фикстурами открывается в dev-сборке
по `/?dev` и `/?scene=<id>`.

Dev-экран клиента показывает карту из бандла (`maps/*.json`, до MAP-04 тестовые карты
`packages/sim/tests/maps/`): выбор карты и «Вписать карту» в панели, перетаскивание сдвигает карту,
колесо меняет масштаб у курсора. Счётчик FPS в панели обновляется дважды в секунду.

Языки интерфейса: русский и английский. При первом визите язык берётся из настроек браузера
(`navigator.languages`: первый из `ru`/`en`, для остальных языков английский), переключатель «Язык» в панели
меняет его и запоминает выбор в `localStorage` (ключ `sbf.locale`; если хранилище недоступно, выбор
действует до перезагрузки). Строки интерфейса лежат в `apps/client/src/i18n/ru.ts` и `en.ts`: отсутствующий
или лишний ключ в `en.ts` — ошибка типов, а `mise run check:i18n` проверяет, что в разметке
нет строк мимо словарей и что наборы ключей совпадают (входит в `mise run test:client`).

## CI

GitHub Actions, `.github/workflows/ci.yml`. Запускается на PR в `develop` и `main`, на push в `develop`
и вручную (`workflow_dispatch`).

**Обязательные проверки** (PR мержится только когда все зелёные):

| Проверка | Что делает |
|---|---|
| `py` | `uv sync --locked`, `ruff check`, `ruff format --check`, `pyright`, `lint-imports`, `gow-maps validate`, `pytest -n auto -m "not perf and not slow"` (pytest-xdist, `HYPOTHESIS_PROFILE=ci`), затем `pytest -m perf` последовательно (бюджеты производительности), реплеи и `check_golden_frozen` |
| `web` | `pnpm -C apps/client install --frozen-lockfile`, шаги `protocol-drift` и `api-drift` (перегенерация схемы протокола с `protocol.gen.ts` и OpenAPI сервера с `api.gen.ts`, падают при отличии от закоммиченных), `lint`, `check`, `test`, `build` |
| `docker` | `hadolint` для `deploy/*.Dockerfile`, затем `deploy/smoke.sh`: сборка образов, `docker compose up`, проверки через Caddy |

- Не обязательный job `py-slow` идёт параллельно с `py` на тех же путях: `pytest -n auto -m slow`, то есть длинные
  тесты полных матчей (доли побед ботов против `random_legal` по 3 и 10 seed на карту, разнообразие по seed,
  турнирный харнесс на всех ботах). Он не задерживает мерж, но его красный результат нужно разобрать до релиза.
  Метки pytest: `perf` (замеры времени, не запускаются под xdist), `slow` (длинные матчи); обе описаны в
  `pyproject.toml`.
- Не обязательный job `e2e` (QA-02, #84): собирает стек (`compose.yaml` + `e2e/compose.e2e.yaml`) и гоняет
  Playwright из `e2e/` в настоящем Chromium. Не обязательный по той же причине, что и `visual`: собирает оба
  образа второй раз, рисует WebGL программно, играет настоящие матчи по 60 секунд (около 5 минут), поэтому он
  самый долгий и самый чувствительный к среде; его красный результат разбирается до релиза. Артефакт `e2e-results`
  (трассы и скриншоты упавших тестов).
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
| `GOW_MAPS_DIR` | `maps` | пул карт: `<id>.json` и необязательный фон `<id>.bg.webp` |
| `GOW_RULESET_PATH` | `rulesets/mvp-0.toml` (в `compose.yaml` и образе `app`: `mvp-1`) | набор правил матчей, которые запускает сервер |
| `GOW_RULESETS_DIR`, `GOW_RULESETS_BUNDLED_DIR` | `rulesets/archive`, `rulesets/archive` | архив рулсетов по хэшу: сервер сам кладёт сюда свой рулсет при старте (каталог должен быть записываемым; в контейнере `/data/rulesets` на томе), архив из образа копируется сюда, если каталоги разные. `test-short` при `GOW_ENV=prod` сервер не принимает |
| `GOW_DATABASE_URL` | `sqlite:///data/gow.db` | база SQLite (WAL); путь относительно рабочего каталога |
| `GOW_GUEST_RATE_LIMIT`, `GOW_GUEST_RATE_WINDOW_S` | `10`, `3600` | не больше N новых гостей с одного IP за окно в секундах |
| `GOW_MATCH_CREATE_RATE_LIMIT`, `GOW_MATCH_CREATE_RATE_WINDOW_S` | `10`, `600` | MOD-01: не больше N созданных матчей (приглашения и матчи с ботом вместе) на игрока за окно |
| `GOW_QUEUE_RATE_LIMIT`, `GOW_QUEUE_RATE_WINDOW_S` | `20`, `60` | MOD-01: не больше N входов в очередь подбора (`POST /api/queue`) на игрока за окно |
| `GOW_QUEUE_WINDOW_BASE`, `GOW_QUEUE_WINDOW_PER_S`, `GOW_QUEUE_WINDOW_MAX` | `100`, `5`, `400` | MM-01: окно подбора по рейтингу `база + k·ожидание` (секунды) с потолком (mechanics.md, раздел 19) |
| `GOW_QUEUE_PASS_S`, `GOW_QUEUE_CONFIRM_S` | `1`, `15` | MM-01: не чаще одного прохода подбора в N секунд; время на подтверждение найденной пары |
| `GOW_QUEUE_BOT_OFFER_S`, `GOW_QUEUE_STALE_S` | `60`, `15` | MM-01: через сколько секунд ожидания предложить бота; игрок, чей клиент молчит столько секунд, выходит из очереди |
| `GOW_NICK_CHANGE_RATE_LIMIT`, `GOW_NICK_CHANGE_RATE_WINDOW_S` | `3`, `86400` | MOD-01: не больше N смен ника (`PUT /api/me/nick`) на игрока за окно |
| `GOW_NICK_BLOCKLIST_FILE` | пусто | MOD-01: файл с дополнительными запрещёнными словами для ников (по слову в строке, `#` комментарий); в контейнере `/data/nick-blocklist.txt` |
| `GOW_INVITE_TTL_S` | `1800` | срок жизни приглашения в приватный матч (секунды) |
| `GOW_READY_TIMEOUT_S` | `120` | SRV-09: время на готовность после входа гостя в приглашение; потом приглашение снимается (неявка) |
| `GOW_WS_ALLOWED_ORIGINS` | `[]` | JSON-список `Origin`, кроме собственного сайта, которым можно открывать WebSocket матча |
| `GOW_WS_HELLO_TIMEOUT_S`, `GOW_WS_SEND_TIMEOUT_S` | `5`, `5` | ожидание `hello`; отправка дольше этого: клиент не читает, отключение |
| `GOW_MONITOR_INTERVAL_S` | `30` | OPS-04: период проверки отставания тиков (порог алерта 10% от периода тика) |
| `GOW_RECONNECT_WINDOW_S`, `GOW_PAUSE_MAX_S` | `60`, `60` | DEC-05: время на переподключение до технического поражения (команда `Forfeit` в журнале); максимум единственной паузы игрока в приватном матче |
| `GOW_WS_MSG_RATE`, `GOW_WS_MSG_BURST` | `20`, `60` | token bucket сообщений одного соединения (в секунду, пачка); больше: флуд, отключение |

База: SQLite, модели в `gow_server/models.py`, миграции Alembic в `gow_server/migrations/versions/`.
Сервер применяет миграции при старте; вручную: `uv run alembic -c apps/server/alembic.ini upgrade head`.
Изменение схемы: поправить модели, затем
`uv run alembic -c apps/server/alembic.ini revision --autogenerate -m "<что>"` и проверить файл миграции.

HTTP API: `GET /api/health`, `GET /api/maps` (список), `GET /api/maps/{id}` (файл карты),
`GET /api/maps/{id}/background.webp` (фон, если есть). Схема: `/docs` на запущенном сервере.

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
- `GET /api/me/active-match` → `{match_id, map_id}` идущего матча игрока или `null` (#189). По нему клиент
  после перезагрузки страницы возвращается в матч: WebSocket с тем же токеном в окне переподключения (DEC-05).
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
GOW_RULESET_PATH=rulesets/mvp-0.toml docker compose up -d   # стек на другом рулсете (по умолчанию mvp-1)
# партия 60 секунд (рулсет test-short) для ручной проверки и E2E: docs/qa/manual-match.md
docker compose -f compose.yaml -f e2e/compose.e2e.yaml up --build -d --wait
```

Задачи mise для стеков (`AGENTS.md`, раздел 3; порты 80/443 у владельца заняты, поэтому у задач свои):

| Задача | Для кого | Что делает |
|---|---|---|
| `mise run stack [рулсет]` | владелец | прод-стек (проект `skill-based-front`) на `http://localhost:8080`, HTTPS 8443, `SITE_ADDRESS=:80`, рулсет по умолчанию `mvp-1` |
| `mise run stack:reset [рулсет]` | владелец | то же с нуля: `down`, удаление тома `gow-data` (база и реплеи), `up` |
| `mise run stack:agent [рулсет]`, `stack:agent:down` | агенты | свой стек (проект `sbf-agent`, `http://localhost:18080`), не задевает стек владельца |
| `mise run smoke` | оба | `deploy/smoke.sh` на проекте `sbf-agent`, в конце стек убирается |
| `mise run e2e` | оба | свой стек `sbf-e2e` (`http://localhost:18082`, рулсет `test-short`), Playwright, стек убирается |

Параллельные агенты на одной машине задают разные `SBF_AGENT_PROJECT`, `SBF_AGENT_HTTP_PORT`, `SBF_AGENT_HTTPS_PORT`
(для `e2e`: `SBF_E2E_*`). Прямые `docker compose ...` без `-p` попадают в проект `skill-based-front`.

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
| `GOW_ENV`, `GOW_LOG_LEVEL`, `GOW_GUEST_RATE_LIMIT`, `GOW_GUEST_RATE_WINDOW_S`, `GOW_RECONNECT_WINDOW_S`, `GOW_PAUSE_MAX_S`, `GOW_MONITOR_INTERVAL_S` | `prod`, `INFO`, `10`, `3600`, `60`, `60`, `30` | настройки сервера (раздел «Сервер»); `e2e` только для прогона Playwright |

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
(OPS-04, #83).

## E2E

`e2e/`: Playwright против настоящего стека (QA-02, #84). Свой пакет (`e2e/package.json`, свой lock-файл):
клиенту нужны Svelte и Vite, E2E нужны только Playwright и TypeScript, и они не зависят от сборки клиента
(тесты видят его только через браузер). Версия `@playwright/test` та же, что у `apps/client` (визуальные тесты).

```sh
mise run e2e                                     # всё сразу: Chromium, свой стек sbf-e2e на :18082, тесты, стек убирается
mise run check:e2e                               # prettier и tsc
```

То же вручную (стек на портах по умолчанию):

```sh
pnpm -C e2e install --frozen-lockfile
pnpm -C e2e exec playwright install chromium     # один раз
docker compose -f compose.yaml -f e2e/compose.e2e.yaml up --build -d --wait   # стек; HTTP_PORT=8080, если 80 занят
E2E_BASE_URL=http://localhost:8080 pnpm -C e2e test   # по умолчанию http://localhost
```

`e2e/compose.e2e.yaml` включает `GOW_ENV=e2e`, рулсет `test-short` (партия 60 секунд), окно переподключения и
паузу по 10 секунд и большой лимит гостей: стек для E2E нельзя использовать как прод.

Тесты (`e2e/tests/`), в каждом свои гости в изолированных контекстах браузера:

| Файл | Что проверяет |
|---|---|
| `invite-match.spec.ts` | два гостя: инвайт, «Готов», по три приказа у каждого (движение, запланированное движение, стойка), матч до конца по таймеру, согласованный итог, «Смотреть реплей» у обоих, проигрывание, пауза и позиция; отдельно пауза (сервер не шлёт снапшоты), обрыв сокета с переподключением и сдача |
| `bot-and-pages.spec.ts` | матч с ботом и сдача; прод-сборка рисует форму ника без ошибок страницы, язык, правовые страницы |

Приказы на карте кликаются по настоящему канвасу: координаты считает `e2e/support/player.ts` теми же функциями камеры и
раскладки, что и клиент (`apps/client/src/render/camera.ts`, `layout.ts`), а принятие приказа проверяется по `ack` в
журнале сокета (сокет проходит через `page.routeWebSocket`, клиент и сервер общаются как обычно). Один тест на
матч, повторов (`retries`) нет: ложный проход скрыл бы нестабильность.

## Прототип на Pygame

Первый прототип (старый дизайн: пять ресурсов, здания, три типа юнитов, бой через урон и броню) в
рабочем дереве больше не лежит. Он сохранён в теге `v0-pygame-prototype` этого репозитория
(`git show v0-pygame-prototype --stat`, `git checkout v0-pygame-prototype`) и в репозитории
`DastinovDS/Game-of-War`. В новой симуляции этот код не переиспользуется; формулы генератора карт
перенесены в `tools/maps/src/gow_maps/bake.py` (MAP-05).

Первая версия дизайн-документа Skill-Based Front лежит в `docs/design/archive/DESIGN-v1.md`
(в репозитории прототипа файл не отслеживался git и скопирован из рабочей копии отдельно).
