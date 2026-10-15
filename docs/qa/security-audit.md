# Аудит безопасности и утечек тумана (QA-04, #86)

Аудит кода, а не документации: каждый пункт проверен чтением исходников и, где можно, на живом
локальном стеке или тестом. Отметка `[x]` значит «проверено», рядом написано чем.

Прогон 2026-10-07, `develop` на `2d521e9` (+ исправления #196 и #198). Стенд: `compose.yaml`,
проект `sbf-qa04`, `HTTP_PORT=8080 HTTPS_PORT=8443`, `SITE_ADDRESS=http://localhost`, `GOW_ENV=prod`,
рулсет `mvp-0`. Только локальный и статический анализ, внешние системы не затрагивались.

## 1. Итог

Критических и высоких находок нет. Две средние исправлены отдельными PR, одна низкая заведена,
одна низкая исправлена в PR этого аудита, остальное принято как осознанный риск.

| # | Серьёзность | Находка | Статус |
|---|---|---|---|
| F1 | Средняя | В журнале сервера IP клиента и query string каждого рукопожатия WebSocket (строка uvicorn в `uvicorn.error`), вопреки AGENTS.md 5.3 и `docs/ops/legal.md` | исправлено: #193, PR #198 |
| F2 | Средняя (защита в глубину) | `/internal/*` (осушение, метрики) открывается заголовком `X-Forwarded-For: 127.0.0.1` от любого узла внутренней сети: uvicorn доверяет всем прокси (`GOW_FORWARDED_ALLOW_IPS="*"`) | исправлено: #194, PR #196 |
| F3 | Низкая | Нет лимита одновременных соединений с одного адреса: WebSocket до `hello` живёт 5 с без аутентификации, у uvicorn нет `limit_concurrency` | заведено: #199 (P2) |
| F4 | Низкая | Dev-зависимость клиента `source-map-js` 1.2.1 (GHSA-68fv-2mgg-jv7q, «high» в базе: DoS при разборе чужой source map). Только сборка и тесты (`postcss`, `jsdom`), в прод-бандл не попадает | исправлено в этом PR: lockfile, 1.2.2 |
| F5 | Инфо | `GET /api/replays/{id}` отвечает 404, 401 или 403: по последовательному id видно, есть ли неранговый матч и готов ли его реплей (содержимое недоступно) | принято |
| F6 | Инфо | Заголовки `Server: Caddy` и `Server: uvicorn` раскрывают ПО | принято |
| F7 | Инфо | Ответ 422 FastAPI возвращает клиенту его собственный ввод (`input`); в журнал он не попадает, токенов в телах HTTP нет | принято |
| F8 | Инфо | Токен гостя лежит в `localStorage`: XSS мог бы его прочитать. Смягчено строгим CSP и отсутствием `{@html}`/`innerHTML` (раздел 6) | принято |
| F9 | Инфо | Проверка `Origin` сравнивает `host:port` с `Host`, но не схему (`http` и `https` одного хоста равны) | принято |

Подробности F1 и F2 (воспроизведение на стенде) в issues #193 и #194.

## 2. Чек-лист issue

- [x] **Вид игрока не содержит скрытого** (id и счётчики включительно): раздел 3.
- [x] **Ошибки не различают «нет» и «не видно»**: раздел 3.4.
- [x] **Токены не в URL и не в журналах**: раздел 4 (нашлась F1, исправлена).
- [x] **Проверка Origin**: раздел 4.
- [x] **Лимиты частоты**: раздел 5 (F3 заведена).
- [x] **CSP**: раздел 6.
- [x] **Фаззинг `ClientMsg`**: раздел 5.2, новый тест `packages/protocol/tests/test_command_fuzz.py`.
- [x] **«Мапхак»: чтение всех сообщений WebSocket за матч**: раздел 3.5, автоматическая запись через
  Caddy вместо глаз в DevTools (сообщения те же, проверка строже).

## 3. Туман войны

### 3.1 Проекция `project()` (`packages/sim/src/gow_sim/view.py`)

- [x] Свои группы и пакеты: только `owner == player`; чужих групп как сущностей нет, только `seen`
  у места. Чужие пакеты не видны никогда (#112).
- [x] Склад только у `EXACT`; на `PRESENCE` у `seen` нет чисел (`systems/vision.py:_sighting`);
  в `FOG` только память `vision_memory`, на рёбрах чисел нет никогда.
- [x] `me` содержит только свои CP и стойку; CP, стойки, производства противника в виде нет.
- [x] Намерения: тип, откуда, куда, тик создания; без id и размера группы. Цели обычного приказа нет:
  у обычного приказа нет намерения.
- [x] Id групп, пакетов и намерений: keyed blake2b с секретным `match_key` (32 байта
  `secrets.token_bytes`, не в журнале, не в `repr`), 63 бита, на проводе 18-19 цифр. Порядок в
  кортежах по непрозрачному id, а не по порядку создания.
- [x] Владельцы и VP публичны по DEC-04. Уровни дорог по DEC-17 (#210) и DEC-22 (#238; типов
  нет после DEC-26, #265): точные только на ребре не в тумане, в тумане последние увиденные
  (`Sighting.width`), иначе уровень 1; казарма, склад и стройки чужих городов скрыты (DEC-26); ёмкость задана видом узла и публична (DEC-22);
  стройки противника видны только на рёбрах не в тумане. Тесты: `test_view.py` (`test_dec17_*`,
  property-тест с изменением уровней и типов в тумане), `test_properties.py` (`MatchMachine.fog`).
- Покрытие тестами: `packages/sim/tests/test_view.py` (`test_property_nothing_leaks_from_places_out_of_sight`:
  изменение скрытого не меняет вид), `test_properties.py` (`MatchMachine.fog`).

### 3.2 Провод: `snapshot_frame` (#155) против строгих моделей

- [x] `gow_protocol.convert._view_data` пишет ровно поля `view_to_wire` в том же порядке; серверные
  поля `depart_tick`, `build_edge`, `back` в кадр не попадают.
- [x] `test_convert.py` на реальных матчах трёх карт MVP и бот-матче сравнивает кадр байт в байт с
  `encode(snapshot_msg(view))`, а JSON кадра с каноническим видом; ищет в каждом кадре id вражеских
  групп и пакетов в пространствах id обоих игроков.
- [x] Вне `prod` сервер валидирует каждый кадр (`MatchManager(validate_snapshots=env != "prod")`).

### 3.3 События, `ack`, `welcome`, `match_end`

- [x] Политика событий: белый список (`convert.py`). Публичны `node_captured`, `vp_awarded`,
  `forfeit`; события боя `fight_started`, `fight_round`, `fight_ended` (DEC-24) обоим
  участникам без `shots_*`/`virtual_*`/`spent_*` противника (место, точка встречи и потери обеих
  сторон остаются, по дизайну); остальное только своему игроку; неизвестный вид не уходит никогда.
- [x] Id сущностей в событиях (`group`, `new_group`, `packet`, `fight`) переводятся в непрозрачные
  id игрока. Вид игрока `fights` (DEC-24, п. I1): у противника только итоги боя (юниты и заряженные),
  без id его групп и без виртуальных выстрелов.
- [x] `ack`: путь приказа строится только по публичным владельцам, `travel_ticks` и рельефу
  (`movement.find_path`); от ширин дорог не зависит, поэтому скрытые ширины (DEC-17) через путь не утекают.
- [x] `welcome`: `RulesetPublic`, `map_id`, `last_seq`; `match_end`: исход, VP, свой рейтинг.

### 3.4 Одинаковые ответы для «нет» и «не видно»

- [x] `resolve()` знает только свои группы; любой чужой или выдуманный id становится
  отрицательным внутренним id, и `validate()` отвечает `NOT_FOUND_OR_HIDDEN`. `NOT_OWNER` с провода
  недостижим: непрозрачных id вражеских групп клиент не получает.
- [x] Узлы и рёбра публичны, поэтому `NOT_OWNER` для узла ничего не раскрывает.
- [x] WebSocket: неизвестный токен, чужой матч, неизвестный или законченный матч, заблокированный
  аккаунт закрываются одним кодом 4004.
- [x] Новый тест `test_command_fuzz.py` проверяет на живом матче, что чужие и выдуманные id всегда дают
  `NOT_FOUND_OR_HIDDEN`.

### 3.5 Мапхак: все сообщения WebSocket за матч

Гость, бот-матч (`pereval`, бот `normal`) через Caddy, клиент на `websockets` читает и пишет всё,
что видел бы DevTools, 300 секунд игры (3003 тика) и сдача. Записано 4430 сообщений: `welcome` 1,
`snapshot` 3003, `ack` 1137, `event` 288, `match_end` 1. Проверки по каждому сообщению:

- набор ключей вида, группы, намерения ровно как в схеме, у `me` только `cp` и `stance`;
- склад не `null` только у `EXACT`, на `PRESENCE` числа врага `null`, свежие `seen` с текущим тиком;
- все id длиной 18-19 цифр, коротких (последовательных) нет; 34 своих id, 1 id намерения;
- все id в событиях встречались среди своих групп и пакетов;
- виды событий только из белого списка; в событиях боя нет `shots_1`/`virtual_1`/`spent_1`
  противника (до DEC-24: `pool_1`/`unspent_1` в `fight`);
- коды отказов только о своих действиях (`CITY_FULL`, `NOT_ENOUGH_CP`, `RECRUIT_COOLDOWN`; после
  DEC-25 вместо кулдауна `QUEUE_FULL`).

Нарушений нет. Взгляд глазами в DevTools браузера это не заменяет полностью, но на уровне сообщений
проверено всё, что он показал бы.

### 3.6 Реплеи

- [x] `GET /api/replays/{id}` отдаёт только файл кадров, и только когда `matches.replay_path`
  заполнен: это делает `ReplayService.finalize` после законченного матча. Идущий матч отвечает 404.
- [x] Журнал команд `{id}.jsonl.gz` с `match_key` не отдаётся никогда; путь файла проверяется на
  нахождение внутри `replays_dir`.
- [x] Неранговые реплеи только участникам (`Authorization: Bearer`), ранговые публичны по дизайну.
  Побочный канал статусов: F5.

## 4. Аутентификация и журналы

- [x] Токен `secrets.token_urlsafe(32)`, в БД только SHA-256 (`models.Player.token_hash`, 32 байта),
  IP в БД не хранится.
- [x] Токен только в `hello` (WebSocket) и `Authorization: Bearer` (HTTP); в клиенте нигде не попадает
  в URL (`net/matchConnection.ts`, `api/http.ts`, `replay/loadReplay.ts`).
- [x] `hello` за 5 с (`ws_hello_timeout_s`), иначе 1008; поиск токена в потоке (`asyncio.to_thread`).
- [x] Модели протокола `extra="forbid"`, `strict`, `hide_input_in_errors=True`, у адаптеров тоже;
  ошибки `hello` пишутся только числом (`exc.error_count()`); у `HelloMsg.token` `repr=False`.
  HTTP-модели гостя тоже `extra="forbid"`, `hide_input_in_errors=True`.
- [x] Журнал доступа: middleware пишет шаблон маршрута (`/api/matches/{code}/join`), без query;
  access log uvicorn выключен. **F1**: строка рукопожатия WebSocket из `uvicorn.error` писала
  `IP:порт` и query string. Исправлено фильтром `DropWebSocketHandshake` (#198), тест на настоящем
  uvicorn.
- [x] Проверка `Origin`: на стенде `Origin: http://evil.example` получает 403 (и запись `ws origin
  refused` без адреса), свой origin проходит. Тесты `test_ws.py`. Схема не сравнивается: F9.
- [x] `X-Forwarded-For`: Caddy заменяет входящий заголовок адресом клиента (на стенде подменённый
  `6.6.6.6` до сервера не дошёл), поэтому лимит гостей на IP не обходится подменой.
- [x] `/internal/*`: Caddy его не проксирует; на стенде `/internal/metrics`, `/api/../internal/...`,
  `/api/%2e%2e/...`, `/api/..%2f...`, `/ws/../...` получают `index.html` клиента. **F2**: изнутри
  сети `X-Forwarded-For: 127.0.0.1` проходил проверку loopback; теперь запрос с заголовком прокси
  получает 404 (#196).

## 5. Ввод и лимиты

### 5.1 Лимиты (MOD-01 и раньше)

- [x] Гости: 10 в час на IP (`SlidingWindowLimiter`); матчи (приглашения и боты): 10 за 10 минут на
  игрока; приглашения: 10 в минуту на аккаунт; смена ника: 3 в сутки; очередь: 20 в минуту.
- [x] WebSocket: token bucket 20 сообщений/с, всплеск 60, переполнение: `RATE_LIMITED` и 1008;
  сообщение не больше 64 КиБ (`ws_max_size`); очередь надёжных сообщений 4096, медленный клиент
  отключается; `send` с таймаутом.
- [x] Целые на проводе ограничены int32, id матчей и файлов проверяются регуляркой.
- F3: нет лимита одновременных соединений с адреса (#199).

### 5.2 Фаззинг

- [x] Кодек: Hypothesis в `packages/protocol/tests/test_validation.py` (любые байты, текст, JSON и
  мутации фикстур дают только `ValidationError`, ошибка не содержит токен).
- [x] Новое: `packages/protocol/tests/test_command_fuzz.py`. Любая команда, прошедшая схему (id свои,
  вражеские в обоих пространствах, случайные, числа до `MAX_INT`), идёт путём сервера до
  `Match.step` на живом матче и получает `ack`, не роняя матч. Падение матча закончило бы его для
  обоих и позволило бы уйти от поражения в рейтинговом матче. Проверено мутацией: без проверки
  границ узла в `Recruit` тест падает с `KeyError`.

## 6. Клиент, CSP и заголовки

- [x] CSP на стенде совпадает с `apps/client/csp.ts`: `default-src 'self'`, `script-src 'self'`
  (без `unsafe-eval`/`unsafe-inline`), `style-src 'self'`, `worker-src 'none'`, `object-src 'none'`,
  `base-uri 'none'`, `frame-ancestors 'none'`, `connect-src 'self'`.
- [x] `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` на
  статике и на `/api`; HSTS только по HTTPS и не для `localhost` (`deploy/Caddyfile`, проверяет
  `deploy/check-caddy.sh` с `BASE_URL=https://...`).
- [x] В `apps/client/src` нет `{@html}`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval`,
  `new Function` (кроме комментария про `pixi.js/unsafe-eval`); ники выводятся интерполяцией Svelte.
- [x] В прод-образе нет `.map` файлов.

## 7. Контейнеры

Проверено `docker inspect` на стенде:

| | пользователь | rootfs | capabilities | no-new-privileges | порты на хосте |
|---|---|---|---|---|---|
| `app` | 10001 (`gow`) | только чтение, `/tmp` tmpfs | `cap_drop: ALL` | да | нет, только сеть `internal` (`internal: true`) |
| `caddy` | 10002 (`caddy`) | только чтение, `/tmp` tmpfs | `cap_drop: ALL`, файловая capability снята | да | 80/443 (на стенде 8080/8443) |

Базовые образы закреплены по версии и digest.

## 8. Секреты и зависимости

- [x] Секреты в истории: проход регулярками (приватные ключи, токены AWS, GitHub, Slack, Discord,
  Google, `sk-...`, JWT, присваивания `password/secret/api_key/token = "..."`, учётные данные в URL)
  по `git log -p --all`, 186 коммитов: 0 совпадений. Из файлов окружения в git только `.env.example`
  без секретов; `ALERT_WEBHOOK_URL` передаётся `curl` через stdin (`deploy/alert-forward.sh`).
- [x] Python: `uvx pip-audit` по `uv export --locked --all-packages` (170 пакетов): уязвимостей нет.
- [x] Клиент: `pnpm audit --prod`: уязвимостей нет; `pnpm audit` (с dev): F4, исправлено.

## 9. Как повторить

```sh
export HTTP_PORT=8080 HTTPS_PORT=8443
docker compose -p sbf-qa04 up --build -d
# Origin и журнал (F1): после исправления в журнале нет строк '"WebSocket ' от uvicorn.error
docker compose -p sbf-qa04 logs app | grep uvicorn.error
# /internal не проксируется: везде index.html клиента, не метрики
for p in /internal/metrics /api/../internal/metrics /api/%2e%2e/internal/metrics; do
  curl -s --path-as-is "http://localhost:8080$p" | grep -c gow_matches_active; done
# F2: из сети internal подмена XFF больше не открывает /internal (404)
docker exec sbf-qa04-caddy-1 wget -qO- --header 'X-Forwarded-For: 127.0.0.1' http://app:8000/internal/drain
uvx pip-audit -r <(uv export --locked --all-packages --no-emit-workspace --no-hashes -q) --no-deps --disable-pip
pnpm -C apps/client audit
uv run pytest packages/protocol/tests/test_command_fuzz.py packages/protocol/tests/test_convert.py \
  apps/server/tests/test_internal.py apps/server/tests/test_ws.py
docker compose -p sbf-qa04 down -v
```

## 10. Остаток вручную

- Просмотр сообщений WebSocket глазами в DevTools браузера (автоматическая запись в разделе 3.5
  покрывает то же на уровне сообщений).
- HTTPS-режим (HSTS, сертификат) на настоящем домене: `BASE_URL=https://<домен> deploy/check-caddy.sh`
  после развёртывания (OPS-03, QA-03).
