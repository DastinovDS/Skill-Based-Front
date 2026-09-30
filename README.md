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
legacy/                            архив прототипа на Pygame, не собирается и не тестируется
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

## CI

GitHub Actions, `.github/workflows/ci.yml`. Запускается на PR в `develop` и `main`, на push в `develop`
и вручную (`workflow_dispatch`).

**Обязательные проверки** (PR мержится только когда обе зелёные):

| Проверка | Что делает |
|---|---|
| `py` | `uv sync --locked`, `ruff check`, `ruff format --check`, `pyright`, `lint-imports`, `pytest` с `HYPOTHESIS_PROFILE=ci` |
| `web` | `pnpm -C apps/client install --frozen-lockfile`, `lint`, `check`, `test`, `build` |

- Вспомогательный job `changes` смотрит на изменённые пути в PR. Если в PR нет изменений для `py` или `web`
  (например, правка только документации), соответствующий job пропускается, а GitHub считает пропущенный job
  успешным: обязательная проверка не зависает в ожидании. Если сам `changes` упал, `py` и `web` запускаются целиком.
  На push в `develop` и при ручном запуске проверяется всё.
- Версии: Python из `.python-version`, pnpm из поля `packageManager`, Node из поля `engines.node`
  в `apps/client/package.json`.

**Branch protection не включена.** Для приватного репозитория на бесплатном плане GitHub API отвечает
`403 Upgrade to GitHub Pro or make this repository public to enable this feature` (и для branch protection,
и для rulesets). Пока это так, правило «мерж только при зелёных `py` и `web`» держится на процессе (AGENTS.md, раздел 11).
После перехода на Pro или открытия репозитория: Settings → Branches → правило для `develop`
(и `main`) с обязательными проверками `py` и `web`, без обязательных ревью, без `enforce_admins`.

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
| `GOW_DATABASE_URL` | `sqlite:///data/gow.db` | база SQLite (WAL); путь относительно рабочего каталога |

База: SQLite, модели в `gow_server/models.py`, миграции Alembic в `gow_server/migrations/versions/`.
Сервер применяет миграции при старте; вручную: `uv run alembic -c apps/server/alembic.ini upgrade head`.
Изменение схемы: поправить модели, затем
`uv run alembic -c apps/server/alembic.ini revision --autogenerate -m "<что>"` и проверить файл миграции.

HTTP API: `GET /api/health`, `GET /api/maps` (список), `GET /api/maps/{id}` (файл карты),
`GET /api/maps/{id}/background.png` (фон, если есть). Схема: `/docs` на запущенном сервере.

## Прототип на Pygame (`legacy/`)

`legacy/` содержит архив первого прототипа (старый дизайн: пять ресурсов, здания, три типа юнитов,
бой через урон и броню). В новой симуляции этот код не переиспользуется; генератор карт из него может
пригодиться как офлайн-инструмент (MAP-05).

- Источник: репозиторий `DastinovDS/Game-of-War`, ветка `develop`,
  коммит `46351b1b1bbaaf1550bc5f0a19adac2316b69fec`. Скопированы только файлы, отслеживаемые git.
- Тег `v0-pygame-prototype` в этом репозитории указывает на коммит, в котором архив появился.
- `legacy/` исключён из линтеров, тайпчекера, тестов и uv workspace. Не редактируйте его.

Первая версия дизайн-документа Skill-Based Front лежит в `docs/design/archive/DESIGN-v1.md`
(в репозитории прототипа файл не отслеживался git и скопирован из рабочей копии отдельно).
