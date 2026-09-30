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
apps/client/                       веб-клиент: TypeScript + Vite + Svelte 5 + PixiJS 8 (появится в INF-03)
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
