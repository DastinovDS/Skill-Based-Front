# AGENTS.md — инструкция для агентов и разработчиков

Этот файл читают AI-агенты (Claude Code, Codex и другие) и люди перед любой работой в репозитории.
Для Claude Code в корне лежит `CLAUDE.md` с одной строкой `@AGENTS.md`.

**Правила здесь обязательны.** Если задача требует нарушить одно из них, остановись и опиши
конфликт в issue или PR, а не обходи правило молча.

---

## 0. Перед началом работы

1. Прочитай issue целиком: задачи, **критерии приёмки**, «вне рамок», зависимости. Одно issue — один PR.
2. Прочитай нужный раздел `docs/design/mechanics.md`. Это единственный источник правды о правилах игры; решения DEC-issues записаны в нём со статусом [принято].
3. **Не придумывай правила.** Если правило не описано или неоднозначно:
   - используй значение по умолчанию из соответствующего DEC-issue;
   - если такого DEC нет — не угадывай: заведи issue с вопросом, оставь `# TODO(#<номер>)` и перечисли вопрос в описании PR.
4. **Ожидаемые значения в тестах берутся из `mechanics.md` и таблиц DEC, а не из вывода твоего кода.** Тест, переписанный под результат кода, ничего не проверяет.
5. Новая зависимость (Python или npm) — только с обоснованием в описании PR.
6. Код, идентификаторы и коммиты — на английском. Документация и issues — на русском.
7. Прототип на Pygame лежит в теге `v0-pygame-prototype` (и в репозитории `DastinovDS/Game-of-War`); в рабочем дереве его нет.

---

## 1. Проект в двух словах

Соревновательная стратегия 1v1 в браузере, партия 10–15 минут. Карта — граф городов и дорог.
Юнит — «батарейка»: заряжен или разряжен. Каждый заряд — один «выстрел»: гасит заряд противника
или убивает одного юнита противника. Столица производит заряды, дороги их развозят, юнит без
заряда беззащитен.

Архитектура:

- **Сервер авторитарен.** Вся логика — на сервере; клиент только рисует и отправляет намерения.
- **Туман войны на сервере.** Каждый игрок получает только то, что видит.
- **Симуляция — чистая детерминированная библиотека** на Python, которую используют сервер, боты, реплеи и тесты.

---

## 2. Структура репозитория и границы

```
packages/sim/        gow_sim       — правила игры: чистая детерминированная симуляция
packages/protocol/   gow_protocol  — Pydantic-модели сообщений клиент ↔ сервер, фикстуры, тест-векторы
apps/server/         gow_server    — FastAPI: HTTP (лобби, рейтинг) + WebSocket (матчи)
apps/bots/           gow_bots      — боты (gow_bots.bots) и турнирный харнесс
apps/client/                       — TypeScript + Vite + Svelte 5 + PixiJS 8
tools/maps/          gow_maps      — валидатор, скрипт отзеркаливания, превью и фоны карт (офлайн)
maps/                              — карты MVP (JSON, превью, фоны)
rulesets/                          — наборы правил (*.toml) и архив сыгранных по хэшу
docs/design/                       — mechanics.md, формат карты, архив
docs/adr/  docs/balance/  docs/qa/ — решения, отчёты баланса, чек-листы
deploy/                            — Dockerfile-ы, Caddyfile, скрипты развёртывания (compose.yaml в корне)
```

**Границы** (проверяются `lint-imports` и правилом ruff TID251):

| Пакет | Может импортировать из проекта | Сторонние зависимости | Нельзя |
|---|---|---|---|
| `gow_sim` | — | только стандартная библиотека | `time`, `random`, `asyncio`, `socket`, `threading`, `datetime.now`; любые пакеты проекта |
| `gow_protocol` | `gow_sim` | `pydantic` | `gow_server`, `gow_bots` |
| `gow_bots.bots` | `gow_sim.view`, `gow_sim.commands`, `gow_sim.maps`, `gow_sim.ruleset` | — | прямой импорт `gow_sim.state`, `gow_sim.systems`, `gow_sim.match` (иначе бот видит скрытое) |
| `gow_bots` (харнесс) | `gow_sim` целиком | `matplotlib` (только отчёты) | `gow_server`, `gow_protocol` |
| `gow_server` | всё выше | `fastapi`, `uvicorn`, `sqlalchemy`, `alembic`, `pydantic-settings` | — |
| `gow_maps` | `gow_sim.maps` | `networkx`, `matplotlib` | `gow_server` |
| клиент | `src/protocol.gen.ts`, `src/api.gen.ts` | `pixi.js`, `svelte`, `howler` | собственные копии правил игры |

---

## 3. Команды

Колонка «с» — issue, после которого команда начинает работать.

| Команда | Что делает | С |
|---|---|---|
| `uv sync --locked` | установить Python-зависимости | INF-01 |
| `uv run ruff check . && uv run ruff format --check .` | линтер и формат | INF-02 |
| `uv run pyright` | проверка типов (strict) | INF-02 |
| `uv run lint-imports` | границы пакетов | INF-02 |
| `uv run pytest` (`HYPOTHESIS_PROFILE=ci` в CI) | тесты, всё подряд (локально) | INF-02 |
| `uv run pytest -n auto -m "not perf and not slow"` | быстрый параллельный прогон (pytest-xdist); так идёт обязательный job `py` | INF-02 |
| `uv run pytest -m perf` | бенчмарки и tick lag (последовательно, не под `-n`: xdist отключает замеры); шаг job `py` | SIM-15 |
| `uv run pytest -n auto -m slow` | длинные тесты полных матчей ботов (доли побед по нескольким seed); не обязательный job `py-slow` | BOT-04 |
| `pnpm -C apps/client install --frozen-lockfile` | установить клиент | INF-03 |
| `pnpm -C apps/client dev` | dev-сервер клиента | INF-03 |
| `pnpm -C apps/client lint && pnpm -C apps/client check && pnpm -C apps/client test && pnpm -C apps/client build` | проверки клиента | INF-03 |
| `pnpm -C apps/client check:i18n` | строки интерфейса только в словарях, одинаковые ключи ru и en (входит в `test`) | CLI-11 |
| `pnpm -C apps/client build && pnpm -C apps/client preview` | прод-сборка локально под целевым CSP (`apps/client/csp.ts`) | INF-03 |
| `uv run python scripts/export_schema.py && pnpm -C apps/client gen:protocol` | перегенерация схемы и TS-типов | PRO-02 |
| `uv run python scripts/export_openapi.py && pnpm -C apps/client gen:api` | перегенерация OpenAPI сервера (`apps/server/openapi.json`) и TS-типов HTTP API (`api.gen.ts`) | CLI-09 |
| `uv run gow-maps validate maps/*.json` | проверка карт | MAP-02 |
| `uv run gow-maps mirror maps/src/<name>.half.json -o maps/<name>.json` | собрать карту из половины (половины лежат в `maps/src/`) | MAP-03 |
| `uv run gow-maps preview maps/*.json` | нарисовать превью `maps/<name>.preview.png` | MAP-04 |
| `uv run gow-maps bake maps/*.json` | запечь фон `maps/<name>.bg.png` (после любой правки карты) | MAP-05 |
| `uv run pytest packages/sim/tests/test_benchmarks.py` | бенчмарки симуляции и проверка бюджетов раздела 12 (`docs/perf.md`) | SIM-15 |
| `uv run python -m gow_sim.replay check packages/sim/tests/golden/v*/**` | проверить реплеи | SIM-16 |
| `uv run python packages/sim/tests/golden/generate.py` | создать золотые реплеи `v{SIM_VERSION}` (после повышения `SIM_VERSION`; существующий каталог не перезаписывает) | SIM-16 |
| `uv run python scripts/check_golden_frozen.py [base]` | золотые файлы из `base` не изменены и не удалены (CI: `HEAD^1`) | SIM-16 |
| `uv run gow-bots tournament --maps maps/*.json --bots all --seeds 100 --jobs 8 --ruleset rulesets/mvp-0.toml` | турнир ботов | BOT-04 |
| `uv run gow-bots report docs/balance/latest.jsonl` | отчёт баланса | BOT-05 |
| `uv run gow-server --reload` | сервер локально | SRV-01 |
| `uv run alembic -c apps/server/alembic.ini upgrade head` | применить миграции БД (сервер делает это и сам при старте) | DB-01 |
| `uv run alembic -c apps/server/alembic.ini revision --autogenerate -m "<что>"` | новая миграция из моделей `gow_server.models` | DB-01 |
| `docker compose up --build -d` | прод-стек локально: `caddy` (клиент, прокси) и `app` (сервер), http://localhost | OPS-01 |
| `deploy/smoke.sh` | собрать и поднять стек, проверить его через Caddy (здоровье, миграции, данные после перезапуска, `check-caddy.sh`, `check-ws-reload.sh`) | OPS-01 |
| `deploy/check-caddy.sh` | заголовки безопасности (CSP равна `apps/client/csp.ts`), кэш, сжатие, маршруты работающего стека; `BASE_URL=https://...` для TLS | OPS-02 |
| `deploy/check-ws-reload.sh` | WebSocket матча через Caddy переживает `caddy reload` (настоящий `/ws/match`, ответ 4001 на `hello` старой версии) | OPS-02 |
| `deploy/deploy.sh [ref]` | деплой на сервере: сборка, осушение матчей (`DEPLOY_DRAIN_TIMEOUT`), бэкап `predeploy`, запуск по healthcheck, откат с восстановлением бэкапа при сбое (`docs/ops/deploy.md`) | OPS-03 |
| `deploy/backup.sh [label]`, `deploy/restore.sh <archive>` | онлайн-бэкап тома `gow-data` (`VACUUM INTO` + реплеи) и восстановление | OPS-03 |
| `deploy/alert-forward.sh` | пересылка алертов сервера (`match_crashed`, `tick_lag`) из лога контейнера в вебхук `ALERT_WEBHOOK_URL`; метрики: `GET /internal/metrics` внутри контейнера (`docs/ops/deploy.md`, «Наблюдаемость») | OPS-04 |
| `deploy/deploy-test.sh` | локальная проверка деплоя, отката сломанного релиза, бэкапа и восстановления в чистый том | OPS-03 |

Если команда из этой таблицы не работает после своего issue — это баг: почини её или обнови таблицу в том же PR.

---

## 4. Симуляция (`gow_sim`)

### 4.1 Правила детерминизма — самые важные в проекте

1. **Шаг — чистая функция состояния.** `Match.step(commands) -> events` меняет только своё состояние. В системах нет I/O, сети, логов, `asyncio`. Чтение и запись файлов разрешены только в `maps.py`, `ruleset.py`, `replay.py`.
2. **Тик — единственные часы.** Все длительности — целое число тиков (10 тиков = 1 секунда).
3. **Только целые числа.** Никаких `float` в состоянии и правилах. Проценты — целые (`value * pct // 100`), доли — в сотых (CP хранятся в сотых долях). `//` только для неотрицательных чисел; округление вниз, и это записано рядом с формулой.
4. **Никаких `set` и `hash()` в логике.** Порядок обхода `set` зависит от `PYTHONHASHSEED`. Хранение — `dict[int, T]`, обход — `for gid in sorted(state.groups)`.
5. **Никакой случайности.** Модуль `random` в `gow_sim` запрещён полностью. Если случайность понадобится — это изменение дизайна через ADR.
6. **Симметрия игроков.** Тай-брейки между игроками запрещены. Одновременные события разрешаются симметрично: сначала вычисляются все перемещения и прибытия, потом все бои (DEC-07, правило 8). Тай-брейк по узлам — только через `node_key(player, node)`: для игрока 1 это id зеркального узла, поэтому поворот карты не меняет решений. Тай-брейк по группам — только внутри одного игрока. Тест зеркальности ловит нарушения.
7. **Числа правил — только из `Ruleset`.** Нужно новое число — добавь поле в `Ruleset` и в `rulesets/*.toml`.

### 4.2 Структура: функциональное ядро, без ECS

```
gow_sim/
  ruleset.py      Ruleset (frozen dataclass) + загрузка TOML
  canonical.py    канонический JSON и blake2b: основа ruleset_hash() и state_hash()
  maps.py         MapDef + загрузчик
  state.py        GameState, Group, Node, Edge, Packet, Intent; to_canonical(), state_hash()
  commands.py     типы команд, validate(), apply_commands()
  systems/        economy, movement, combat, capacity, supply, recruit, build, orders, victory, vision
  view.py         project() -> PlayerView
  match.py        Match, порядок систем, run_headless()
  replay.py       запись, проверка, дамп расхождений
  analysis.py     метрики матча из журнала событий (турниры и реальные матчи)
```

Сущности — `@dataclass(slots=True)`; команды, `Ruleset`, `MapDef`, `PlayerView` — `@dataclass(frozen=True, slots=True)`.
Группа хранит счётчики `units` и `charged`, а не список юнитов.

Система — функция с одной сигнатурой: меняет состояние на месте и возвращает события.

```python
def combat(state: GameState, rules: Ruleset) -> list[Event]:
    events: list[Event] = []
    for node_id in sorted(state.contested_nodes()):   # всегда sorted
        ...
    return events
```

**Порядок систем фиксирован** и меняется только вместе с `SIM_VERSION`:

```
apply_commands → economy → movement → combat → capacity → supply (включая перезарядку)
→ recruit → build → orders → victory → vision (обновление памяти «последний раз видели»)
```

Порядок в коде: `gow_sim.match.SYSTEMS`. `Match.step()` сначала увеличивает `state.tick`, поэтому все системы тика `t` видят `state.tick == t` (первый тик 1); события каждой системы сразу дописываются в `state.events`, и следующие системы их читают.

`combat` получает бонусы запланированных приказов и «Защиты» из `systems.orders.active_bonuses(state)`;
`orders` снимает потраченные бонусы и намерения закончившихся приказов, режимов и строек (SIM-10).

Память тумана хранится в `GameState` (для каждого игрока), поэтому `project()` остаётся чистой функцией, а реплей — воспроизводимым.

### 4.3 Команды

- Клиент и бот присылают **намерение** (`Move(group, dest, planned)`), никогда не состояние.
- `validate(state, rules, player, cmd) -> Ok | Reject(code)`: владение, видимость, достижимость, CP (стоимости берутся из `rules`).
- **Одинаковый отказ** `NOT_FOUND_OR_HIDDEN` для «не существует» и «не видно».
- Команды применяются **в начале следующего тика** в порядке `(player_id, seq)`; команды одного игрока не влияют на валидность команд другого в том же тике.
- Отклонённая команда не меняет состояние.
- Сдача и техническое поражение — команда `Forfeit` в журнале, а не особый путь в коде.
- Непрозрачные id из команд переводятся во внутренние одной функцией `gow_sim.view.resolve(state, player, cmd, match_key)` — её используют и сервер, и `run_headless`. Неизвестный id даёт `NOT_FOUND_OR_HIDDEN`.

### 4.4 Туман войны и проекция

- `project(state, rules, player, match_key) -> PlayerView` — **единственное**, что покидает симуляцию в сторону игрока. Боты получают тот же `PlayerView`, что и люди. `rules` и секретный `match_key` не входят в `GameState`, поэтому передаются явно.
- В `PlayerView` **нельзя**:
  - сущности в невидимых узлах и рёбрах, точные числа там, где DEC-04 разрешает только «есть враг»;
  - последовательные глобальные id — только непрозрачные id для каждого игрока (keyed blake2b с секретным `match_key` матча, не с публичными данными);
  - CP, стойку, производство и общие счётчики противника;
  - события боёв и снабжения в тумане;
  - размер и id группы в намерениях; цель обычного приказа противника.
- Новое поле в `PlayerView` — только вместе с тестом тумана на это поле.

### 4.5 Реплеи и версии

- Журнал реплея: заголовок `{sim_version, ruleset_hash, python_version, map_id, map_hash, match_key}` + `(tick, player, seq, cmd)` + контрольные хэши каждые 50 тиков. Формат `.jsonl.gz` (gzip из стандартной библиотеки).
- Для просмотра сервер после матча пересимулирует журнал в `ProcessPoolExecutor` (не в цикле событий и не в потоке) и пишет файл полных кадров — он не зависит от будущих версий симуляции. Формат: `docs/design/replay-frames.md`.
- `state_hash()` — blake2b канонического JSON (`sort_keys=True`, без float).
- Золотые реплеи лежат в `tests/golden/v{SIM_VERSION}/`. **Изменил правило или порядок систем** → повысь `SIM_VERSION`, создай каталог новой версии, объясни в PR, что изменилось. Каталоги прежних версий не меняются.
- Рулсет, на котором играли, сохраняется в `rulesets/archive/<hash>.toml`.

---

## 5. Сервер (`gow_server`)

### 5.1 Модель процесса

- **Один процесс, `--workers 1`.** Состояние матчей живёт в памяти одного процесса.
- Один `asyncio`-таск на матч. Масштабирование позже — несколько процессов, каждый со своими матчами.
- `lifespan` вместо `@app.on_event`.

### 5.2 Тик-цикл

Время приходит через абстракцию `Clock` — в тестах часы управляемые, и тесты не ждут реального времени.

```python
async def run(self) -> None:
    dt = 1.0 / self.tick_hz
    next_t = self.clock.now()
    while not self.match.finished:
        if self.paused:
            await self.resumed.wait()
            next_t = self.clock.now()
        now = self.clock.now()
        if now - next_t > 3 * dt:     # сильное отставание (GC, VM): сбросить, а не догонять
            next_t = now
        while now >= next_t and not self.match.finished:
            self.step()                # синхронно: применить команды, шаг, проекции, положить в очереди
            next_t += dt
        await self.clock.sleep(next_t - self.clock.now())
```

- **Внутри шага нет `await`**: ни сети, ни базы данных.
- Исключение в матче логируется с id матча и не затрагивает другие. Держи сильные ссылки на таски.

### 5.3 Соединения

- Первое сообщение — `hello` с токеном, таймаут 5 секунд. Токен **никогда** не в URL и не в логах.
- Проверка `Origin` при апгрейде WebSocket.
- Задачи чтения и записи в `TaskGroup`. Две очереди на соединение:
  - **снапшоты** — ячейка «только последний»: медленный клиент пропускает кадры и не тормозит тик;
  - **всё остальное** (`ack`, `event`, `match_end`, `error`) — надёжная FIFO-очередь.
- `send` с таймаутом; зависший клиент отключается.
- Прикладной `ping/pong` (браузер не видит протокольные пинги).
- Дедупликация по `seq`, `ack` с тиком применения и путём или кодом отказа, token bucket на команды.
- Переподключение: тот же токен, полный `PlayerView` и `last_seq` в `welcome`.
- Разрыв (DEC-05, `MatchRunner`): окно `GOW_RECONNECT_WINDOW_S` (60 с), матч идёт. По истечении сервер ставит в очередь команду `Forfeit` отключившегося, как обычную команду (она попадает в журнал реплея, `match_end.reason = disconnect`). Окно идёт и до первого подключения. Паузы только в приватных матчах (`pause`/`resume`, одна на игрока, до `GOW_PAUSE_MAX_S`).
- Новое соединение того же игрока закрывает старое кодом 4009; клиент после 4009 **не** переподключается (иначе две вкладки вечно вытесняют друг друга).

### 5.4 Жизненный цикл матча (SRV-09, `gow_server.lifecycle`)

- Состояния: создан → ожидание готовности → идёт → окончен → сохранён → очищен (`MatchState`, таблица `TRANSITIONS`); не начавшийся матч (приглашение истекло, заменено, неявка `GOW_READY_TIMEOUT_S`) уходит в `aborted` и сразу очищается.
- Строка `matches` создаётся до старта (`status=running`), раннер запускается с `match_id=str(matches.id)`. Итог (`status`, `end_reason`, `ticks`, `match_players.result`) пишется через `asyncio.to_thread` после конца матча; незавершённые строки при старте процесса получают `aborted` / `server_restart`.
- У игрока не больше одного активного матча (`MatchLifecycle.claim`, 409): с момента пары (вход гостя, бот-матч) до конца матча. Очередь (MM-01) занимает игрока тем же способом.
- Рулсет сервера архивируется в `GOW_RULESETS_DIR/<hash>.toml` при старте; `test-short` при `GOW_ENV=prod` не запускается.

### 5.5 Безопасность

- В базе хранится только SHA-256 токена.
- Входящие сообщения валидируются `TypeAdapter(ClientMsg).validate_json(raw)`, модели с `extra="forbid"` и `hide_input_in_errors=True` (иначе токен попадёт в текст ошибки и в логи).
- Лимиты частоты: создание гостей, матчей, вход в очередь, команды в матче.
- Рулсет `test-short` доступен только в dev и e2e окружении.

---

## 6. Протокол (`gow_protocol`)

- **Pydantic-модели — единственный источник правды.** Сообщения — tagged union по полю `type`.
- `apps/client/src/protocol.gen.ts` и `api.gen.ts` генерируются и **не редактируются руками**. CI падает при дрейфе.
  Цепочка протокола: модели → `gow_protocol.schema` → `packages/protocol/protocol.schema.json` →
  json-schema-to-typescript → `protocol.gen.ts` (команда в разделе 3). Там же тип файла карты `MapFile`
  (`gow_protocol.mapfile`), по которому клиент читает `GET /api/maps/{id}`.
- Любое изменение протокола → повысь `PROTOCOL_VERSION`. Клиент со старой версией получает код закрытия 4001.
  `PROTOCOL_VERSION` и `CLOSE_PROTOCOL_VERSION` попадают в клиент тем же путём: схема несёт их в `x-constants`,
  `apps/client/scripts/protocol-consts.js` дописывает `export const` в конец `protocol.gen.ts`.
- Кодек — в одном модуле (`codec`): JSON сейчас, msgpack позже заменой одного файла.
- Протокольные модели и модели БД — разные классы.

---

## 7. Клиент (`apps/client`)

### 7.1 В клиенте нет логики игры

- Клиент рисует снапшоты и отправляет намерения. Он не решает, кто победил в бою, дошёл ли пакет, хватает ли ёмкости. Путь для приказа приходит в `ack` — клиент его не считает.
- Единственное исключение — **оценка боя** в HUD. Она считается по `ruleset_public`, помечена в коде и интерфейсе как оценка, никогда не влияет на отправку команд и проверяется общими тест-векторами из Python (`packages/protocol/vectors/`).

### 7.2 PixiJS и Svelte

- PixiJS рисует только карту в одном `<canvas>`; **весь интерфейс — HTML/CSS на Svelte** поверх. Не рисуй кнопки и окна в PixiJS.
- Объекты PixiJS живут **вне реактивности Svelte**. Буфер снапшотов и интерполяция — обычный TypeScript.
- HUD — класс в `.svelte.ts` с полем `current = $state.raw(...)`, которое заменяется раз на снапшот (10 Гц), а не каждый кадр. Экспортировать переприсваиваемый `$state` напрямую из модуля нельзя — Svelte это не компилирует.
- Слои контейнеров: фон → территория → дороги → узлы → группы → намерения → туман → эффекты.
- Всё, что создал, уничтожай: `obj.destroy({ children: true })`, созданные текстуры, `app.destroy()` при размонтировании. Асинхронный `app.init()` может завершиться после размонтирования — проверяй флаг.
- CSP: целевая политика лежит в `apps/client/csp.ts` (Caddy генерирует из неё заголовок при сборке образа, `deploy/caddy.Dockerfile`). `import 'pixi.js/unsafe-eval'` вместо разрешения `unsafe-eval`; текстуры грузятся без воркеров (`Assets.setPreferences({ preferWorkers: false })`, `worker-src 'none'`); `style-src 'self'` без `unsafe-inline`, поэтому в разметке Svelte нет статических атрибутов `style="..."` (стили из JS через CSSOM и директивы `style:` разрешены).

### 7.3 Сеть и плавность

- Рендер идёт на 2–3 снапшота позади последнего и интерполирует позиции на рёбрах. Без экстраполяции и без предсказания.
- Отправленный приказ сразу показывается «призраком» и подтверждается или откатывается по `ack`.

### 7.4 Интерфейс

- Все строки — через `t("key")` с первого экрана (INF-03); словари ru и en с одинаковым набором ключей.
- **Состояние не передаётся только цветом**: заряд — заполненная или пустая точка, владелец — цвет плюс контур или узор.
- Никаких `{@html}` и `innerHTML` с пользовательскими данными (ники).

---

## 8. Боты (`gow_bots`)

- Бот реализует `Controller.decide(view: PlayerView, tick) -> list[Command]`, видит только `PlayerView` и вызывается раз в 5 тиков.
- Параметры бота выбираются детерминированно по seed матча — без этого детерминированные матчи повторяются, и турнир ничего не измеряет.
- Выбор «обычный или запланированный приказ» — общая функция полезности от цен рулсета.
- Турнир — один матч на процесс, обе стороны для каждой пары; JSONL-результат воспроизводим. После правки рулсета — турнир и отчёт в PR.

---

## 9. Данные

- SQLite в режиме WAL (`journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`), SQLAlchemy 2 с `Mapped[]` и `select()`, миграции Alembic (`render_as_batch=True`).
- **Синхронный SQLAlchemy — только в `def`-эндпоинтах** (FastAPI выполнит их в threadpool) или через `asyncio.to_thread`. Вызов базы внутри `async def` блокирует цикл событий всех матчей.
- Реплеи — файлы в `data/replays/`; в БД только метаданные и путь.
- Изменение схемы БД — только через миграцию.

---

## 10. Тестирование

| Уровень | Что | Где |
|---|---|---|
| Табличные тесты правил | каждая строка таблиц DEC и примеры mechanics.md | `packages/sim/tests/test_<system>.py` |
| Сценарные тесты | крошечные карты, точное состояние на тике N | `packages/sim/tests/scenarios/` |
| Зеркальность | зеркальный старт + зеркальные команды → зеркальное состояние | `packages/sim/tests/test_symmetry.py` |
| Property-тесты | Hypothesis: сохранение зарядов, нет отрицательных, нет утечек тумана | `packages/sim/tests/test_properties.py` |
| Детерминизм | один матч в свежих процессах с разными `PYTHONHASHSEED` | `packages/sim/tests/test_determinism.py` |
| Золотые реплеи | хэши контрольных точек текущей версии | `packages/sim/tests/golden/v*/` |
| Сервер | интеграция через настоящий WebSocket-клиент, управляемые часы | `apps/server/tests/` |
| Клиент | Vitest: интерполяция, сеть, оценка боя по тест-векторам | `apps/client/src/**/*.test.ts` |
| E2E | Playwright: два браузера, матч по инвайту на `test-short` | `e2e/` |
| Баланс | турнир ботов, отчёт с доверительными интервалами | `docs/balance/` |

**Что обязательно при изменении:**

| Меняешь | Обязательно |
|---|---|
| правило в `gow_sim` | тест из mechanics.md; `SIM_VERSION`++; новые золотые реплеи; правка mechanics.md |
| число в рулсете | турнир ботов и отчёт в PR |
| поле в `PlayerView` | тест тумана на это поле |
| протокол | `PROTOCOL_VERSION`++; перегенерация TS-типов |
| схему БД | миграция Alembic |
| команду из раздела 3 | обновить раздел 3 |

---

## 11. Процесс

- **Ветки:** `feature/<номер issue>-<slug>` от `develop`, например `feature/91-combat-bounce`; исправления — `fix/<номер>-<slug>`.
- **Коммиты:** `<type>(<scope>): <сообщение> (#<номер>)`, например `feat(sim): add bounce rule (#91)`.
  - Номер в конце, а не в начале: при редактировании сообщения в редакторе и при rebase git удаляет строки, начинающиеся с `#`.
  - `type`: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`.
  - `scope`: `sim`, `protocol`, `server`, `bots`, `client`, `maps`, `infra`, `docs`.
- **PR** в `develop`, в описании — `Closes #<номер>` и отмеченные критерии приёмки. `develop` — ветка по умолчанию на GitHub (иначе `Closes` не закрывает issue). `main` — только релизы.
- **CI:** обязательные проверки `py`, `web` и `docker` (`.github/workflows/ci.yml`, подробности в README). Не обязательный `py-slow` гоняет тесты с меткой `slow` (длинные статистические матчи ботов); новый тест дольше ~5 с на полный матч помечай `@pytest.mark.slow`, замеры времени помечай `@pytest.mark.perf`. Мерж — только когда все обязательные проверки зелёные (`gh pr checks <PR> --watch`; красный `py-slow` разбирай, но он не блокирует). GitHub этого не принуждает: branch protection недоступна на текущем плане, правило держится на процессе.
- **Шаблоны:** `.github/pull_request_template.md` (чек-лист Definition of Done ниже) и `.github/ISSUE_TEMPLATE/` (feature, bug, decision). Меняешь Definition of Done — поменяй и шаблон PR.
- **Закрытие issue после мержа — вручную.** В этом репозитории `Closes #N` сейчас не связывает PR с issue (у PR пустой `closingIssuesReferences`, хотя база — ветка по умолчанию), поэтому автор закрывает issue сам: `gh issue close <N> --comment "Done in #<PR>"`.

### Definition of Done

- [ ] Все критерии приёмки issue выполнены и отмечены в PR.
- [ ] CI зелёный: ruff, pyright strict, lint-imports, pytest, lint и check клиента, Vitest, дрейф протокола.
- [ ] Новые правила покрыты тестами с ожидаемыми значениями из mechanics.md.
- [ ] При изменении правил или протокола повышены версии и перегенерированы артефакты (раздел 10).
- [ ] mechanics.md, AGENTS.md или README обновлены, если изменилось поведение или команды.
- [ ] В коде нет `TODO` без номера issue.

---

## 12. Бюджеты производительности

Эталонная машина описана в `docs/perf.md`.

| Что | Бюджет |
|---|---|
| Шаг симуляции без проекций, 40 узлов, 40 групп | в среднем ≤ 0,3 мс, p99 ≤ 1 мс |
| Одна проекция `project()` | ≤ 0,3 мс |
| Шаг снабжения (входит в шаг симуляции) | ≤ 0,1 мс |
| Решение бота (раз в 5 тиков) | ≤ 1 мс |
| Полная партия двух ботов headless | ≤ 8 с |
| Турнир 1000 матчей на 8 ядрах | ≤ 20 мин |
| Сервер: один процесс (одно ядро) | 30 параллельных матчей, отставание тиков < 10% |
| Клиент | 60 FPS на интегрированной графике |
| Файл кадров реплея 12-минутного матча | ≤ 2 МБ |

Бенчмарки — `pytest-benchmark`; регрессия больше 50% ломает CI.

---

## 13. Устаревшие API, которые агенты часто пишут по памяти

| Библиотека | Не писать | Писать |
|---|---|---|
| PixiJS 8 | `new Application({...})` синхронно; `beginFill` / `drawRect` / `endFill`; `BaseTexture` | `await app.init({...})`; `g.rect(...).fill(...).stroke(...)`; `Texture`, `Assets` |
| Svelte 5 | `export let`, `$:`, `on:click`, `createEventDispatcher`, stores для состояния компонента | `$props()`, `$derived`, `$effect`, `onclick`, callback-пропсы, `$state` / `$state.raw` |
| Pydantic 2 | `.dict()`, `.json()`, `parse_obj`, `@validator`, `class Config` | `.model_dump()`, `.model_dump_json()`, `model_validate`, `@field_validator`, `model_config = ConfigDict(...)` |
| SQLAlchemy 2 | `session.query(...)`, `declarative_base()`, `Column(...)` без типов | `session.execute(select(...))`, `DeclarativeBase`, `Mapped[...] = mapped_column(...)` |
| FastAPI | `@app.on_event("startup")` | `lifespan` |

---

## 14. Не делать

- Логику игры в клиенте (кроме помеченной оценки боя).
- `float`, `time`, `random`, обходы `set` и `hash()` в `gow_sim`; тай-брейки между игроками.
- Числа правил в коде систем вместо `Ruleset`.
- Отправку игроку чего-либо, кроме результата `project()`; разные ошибки для «не существует» и «не видно».
- `await` внутри шага матча; синхронную базу данных внутри `async def`; несколько воркеров uvicorn.
- Ручную правку `protocol.gen.ts` и `api.gen.ts`.
- Токены в URL, логах и открытом виде в БД.
- Интерфейс в PixiJS; объекты PixiJS в `$state`; обновление HUD каждый кадр.
- Состояние, передаваемое только цветом.
- ECS, собственный движок UI, абстракции «на будущее» без задачи.
- Новые механики вне mechanics.md и без флага в рулсете.

---

## 15. Глоссарий

| Термин | В коде | Значение |
|---|---|---|
| тик | `tick` | шаг симуляции, 10 в секунду |
| рулсет | `Ruleset` | все числа и флаги правил, `rulesets/*.toml` |
| город / узел | `Node` | вершина графа; в MVP каждый узел — город со складом |
| дорога / ребро | `Edge` | связь узлов; `width` — пропускная способность |
| внутреннее ребро | `is_internal` | оба конца у одного владельца; только его можно улучшать и только по нему идёт снабжение |
| буферное ребро | `is_buffer` | концы у разных владельцев или один нейтральный |
| группа | `Group` | юниты одного игрока в одном месте: `units`, `charged` |
| заряд | `charged` | заряженный юнит; каждый заряд — один «выстрел» |
| склад | `warehouse` | запас зарядов города |
| ёмкость | `capacity` | сколько юнитов и зарядов держит город; зависит от внутренних дорог |
| пакет | `Packet` | заряды в пути по дороге |
| отскок | `bounce` | атакующий без победы возвращается в исходный узел разряженным |
| запланированный приказ | `planned=True` | дороже, виден всем как намерение, выступает с задержкой, даёт одноразовый бонус |
| намерение | `Intent` | видимая всем часть запланированного приказа: откуда, куда, тип — без размера и id группы |
| режимы | `Mode.ATTACK / DEFENSE / BUILD` | «Атака», «Защита», «Строительство» |
| CP | `cp` | командные очки; плоский реген, не растут от территории; хранятся в сотых долях |
| стойка | `Stance.ECONOMY / BALANCE / WAR` | доля регена CP, уходящая в заряды |
| вид игрока | `PlayerView` | отфильтрованное туманом состояние для игрока или бота |
| VP | `vp` | очки победы за удержание городов |
