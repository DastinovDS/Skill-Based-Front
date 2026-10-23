# Баланс: турнир ботов и формат результата

Турнир (BOT-04, #37) гоняет ботов друг против друга на картах и пишет по строке JSONL на матч.
Отчёт по этому файлу строит `gow-bots report` (BOT-05, #38); этот документ описывает формат,
на который он опирается.

> Map ids were renamed to English in #390 (`arteriya` is `artery`, `pautina` is `web`, `pereval` is `pass`, `hrebet` is `ridge`, `perekrestki` is `crossroads`, `trakt` is `highway`); the tournament results and reports in this folder keep the old ids on purpose, they are history and are not rewritten.

## Запуск

```bash
uv run gow-bots tournament --maps maps/*.json --bots all --seeds 100 --jobs 8 --ruleset rulesets/mvp-1.toml
```

| Ключ | Смысл |
|---|---|
| `--maps` | файлы карт (шелл раскрывает глоб; нераскрытый глоб тоже работает) |
| `--bots` | имена из `gow_bots.bots.BOTS` или `all` (весь реестр, новые боты подхватываются сами) |
| `--seeds N` | `N` сидов на карту и пару: `seed-base .. seed-base + N - 1` |
| `--seed-base` | первый сид, по умолчанию 0 |
| `--jobs` | число процессов, по умолчанию число ядер |
| `--ruleset` | рулсет, по умолчанию `rulesets/mvp-0.toml` |
| `--out` | файл результата, по умолчанию `docs/balance/latest.jsonl` |
| `--replays DIR` | дополнительно записать реплей каждого матча в `DIR` |

Матчей: `карты x боты x боты x сиды`. Играет каждая **упорядоченная** пара `(бот стороны 0, бот
стороны 1)`: каждая пара встречается обеими сторонами, каждый бот играет и сам с собой (это даёт
оценку перекоса сторон карты). Сид матча общий для обоих ботов; параметры бота выбираются из
`(имя, сид, сторона)` (AGENTS.md, раздел 8).

Один матч = один процесс (`ProcessPoolExecutor`, `max_tasks_per_child=1`, старт `spawn`). Порядок
строк фиксирован: `(карта, сид, бот0, бот1)`, где карты и боты отсортированы по имени. Результат
зависит только от аргументов и кода: повторный запуск даёт тот же файл байт в байт (в строках нет
времени и путей). Файл пишется в `<out>.tmp` и переименовывается по окончании.

Метрики реального матча (реплей PT-01 / REL-01) тем же кодом:

```bash
uv run gow-bots analyze path/to/match.jsonl.gz --rulesets rulesets/archive --maps maps
```

Печатает такую же JSON-строку с метриками (без полей идентификации матча, но с `replay`) и ключом
`stats` со статистикой игроков (раздел «Статистика игроков»). Таблица для чтения человеком:

```bash
mise run stats path/to/match.jsonl.gz            # аргументы после имени задачи: файлы и опции
uv run gow-bots stats a.jsonl.gz b.jsonl.gz --rulesets rulesets/archive --maps maps
```

## Формат строки (`schema` = 1)

Одна строка = один JSON-объект, ASCII, без пробелов. Поля с `[a, b]` индексируются id игрока
(0 и 1, то есть стороной). Значение `null` в списке: метрики нет (деление на ноль).

| Поле | Тип | Смысл |
|---|---|---|
| `schema` | int | версия формата строки; растёт при удалении или смене смысла поля |
| `map` | str | имя карты (`meta.name`) |
| `map_hash` | str | хэш карты |
| `ruleset_hash` | str | хэш рулсета |
| `sim_version` | int | `SIM_VERSION` движка |
| `seed` | int | сид матча (ботов) |
| `bot0`, `bot1` | str | имена ботов стороны 0 и 1 |
| `state_hash` | str | `state_hash` финального состояния (проверка воспроизводимости) |
| `winner` | int или null | победившая сторона; `null`: ничья или матч не закончен |
| `reason` | str | причина окончания: `capital`, `forfeit`, `vp`, `cities`, `draw`, `double_defeat` (значения `EndReason`) или `unfinished` |
| `ticks` | int | последний сыгранный тик |
| `duration_s` | float | `ticks / tick_hz`, секунды игрового времени |
| `vp` | [int, int] | итоговые очки победы |
| `cities` | [int, int] | число узлов у игрока в конце |
| `orders` | [int, int] | принятые приказы `Move` |
| `attack_orders` | [int, int] | из них атакующие: цель не принадлежала игроку на момент приказа |
| `planned_attack_orders` | [int, int] | из атакующих запланированные (`planned=true`) |
| `planned_attack_share` | [float или null, ...] | `planned_attack_orders / attack_orders`, 4 знака; `null` без атак |
| `sieges` | [int, int] | попытки осады: бой за узел врага с игроком как атакующим, либо вход в пустой узел врага |
| `sieges_won` | [int, int] | успехи осад: захваты узлов врага (нейтральные не считаются) |
| `captures` | [int, int] | все захваты узлов, включая нейтральные |
| `captures_by_minute` | [[int, ...], [int, ...]] | захваты игрока по минутам матча; минута `m`: тики `m*60*tick_hz < t <= (m+1)*60*tick_hz`; длина `ceil(ticks / (60*tick_hz))`, не меньше 1 |
| `accepted` | [int, int] | принятые команды всех видов |
| `rejected` | [int, int] | отклонённые команды |
| `stock_mean_centi` | [int или null, ...] | среднее суммарного запаса зарядов в сотых долях заряда (#310, раздел «Charge stock and burned share»); `null` без замеров |
| `stock_peak` | [int, int] | пик суммарного запаса зарядов (#310) |
| `charges_produced` | [int, int] | произведено зарядов: сумма `charges` событий `charges_produced` (#310) |
| `charges_burned` | [int, int] | сгорело зарядов: сумма `charges` событий `charges_overflow` (#310) |
| `burned_permille` | [int или null, ...] | доля сгоревшего в промилле, `charges_burned * 1000 // charges_produced`; `null` без производства (#310) |

Поля `stock_*`, `charges_*` и `burned_permille` добавлены в #310 без смены `schema`: ничего не удалено и
не изменило смысл. Файлы турниров старше #310 их не содержат, отчёт показывает по ним «нет данных».

Определения метрик заданы в `packages/sim/src/gow_sim/analysis.py` (модульная строка документации).
«Запланированный» и «атакующий» приказ в журнале событий не виден (`Move` не оставляет события),
поэтому `MatchRecorder` классифицирует приказ в момент применения.

## Статистика игроков (#375)

Метрики выше описывают исход и бои; статистика игроков описывает, **как играл человек или бот**.
Источник: журнал команд матча (все присланные команды с вердиктом `validate` и ценой, которую
списала симуляция) и события, которые симуляция уже пишет (`stance_changed`, `transfer_started`,
`recruit_cancelled`). Новых событий нет, `state_hash` не меняется. Код: `gow_sim.analysis`
(`analyze_stats`, `PlayerStats`), модульная строка документации там же; вывод: ключ `stats` в
JSONL `gow-bots analyze` и таблица `gow-bots stats`. В строки турнира статистика не входит
(`MatchMetrics` не менялся). Реплей нужно пересимулировать, поэтому нужны рулсет и карта (архив
`rulesets/archive/<hash>.toml`). Метрика запаса зарядов (#310) считает состояние, а не действия:
это отдельные поля, общего с ними только `MatchRecorder`/`MatchLog`.

`stats.players[p]` (по стороне `p`, 0 или 1):

| Поле | Смысл |
|---|---|
| `stance_timeline` | список `[тик, стойка]`: первая запись `[0, economy.start_stance]`, затем каждый принятый `SetStance` |
| `stance_ticks` | тики в каждой стойке; стойка, выставленная в тик `t`, работает с тика `t` (`apply_commands` идёт перед `economy`), стартовая стойка с тика 1; сумма равна `ticks` |
| `commands` | все присланные команды игрока, кроме `Forfeit`; `rejected` из них отклонено (в `MatchMetrics.rejected` `Forfeit` входит) |
| `apm_avg` | `commands * 60 * tick_hz / ticks`, 3 знака; `null` при `ticks = 0` |
| `apm_by_minute`, `apm_peak` | команды по минутам матча (минута `m`: тики `m*60*tick_hz < t <= (m+1)*60*tick_hz`, последняя минута может быть короче) и максимум по ним |
| `supply` | тики принятых `SetFront` (`set_front`), `SetRearMin` (`set_rear_min`), `Transfer` (`transfer`); `transfer_charges`: сумма зарядов из `transfer_started` (перевозка обрезается по свободному месту цели, поэтому может быть меньше `n` команды) |
| `orders`, `planned_orders` | принятые `Move` и из них запланированные |
| `planned_share` | `planned_orders / orders`, 4 знака; `null` без приказов |
| `planned_attack_share` | как в `MatchMetrics` |
| `cp_by_category` | траты CP в сотых долях по принятым командам и ценам `orders.cost` рулсета: `move`, `planned_move`, `mode` (`SetMode`), `recruit` (найм минус возвраты `CancelRecruit`), `road` (`UpgradeRoad`), `barracks`, `warehouse`, `transfer`, `other` (`Split`, `Merge`, `CancelOrder`, `SetStance`, `SetFront`, `SetRearMin`: в рулсетах MVP бесплатны) |
| `cp_refunded`, `cp_total` | возврат за отмену найма (уже вычтен из `recruit`) и сумма категорий |

Отклонённая команда ничего не стоит. Реальный баланс CP (реген, сгорание на потолке) не
восстанавливается: это траты по командам. Решения по спорным местам приняты по умолчанию
(комментарий в #375): чистые траты с возвратами, `Forfeit` вне APM, офлайн-инструмент без
показа в игре и без серверного API.

## Charge stock and burned share (#310)

A balance statistic of how much a player stores and how much of the production is wasted. It is
**not a game rule**: no DEC, no ruleset field, nothing in `mechanics.md` changes, and the
simulation does not know about it (the state hash and `SIM_VERSION` are untouched). It exists to
check on tournaments the conclusions of DEC-28 about accumulation (`mechanics.md`, section 8,
"Накопление: граничные случаи"): a quiet phase runs into the storage and the surplus burns. Code:
`gow_sim.analysis` (`charge_stock`, `MatchRecorder`, `MatchMetrics`), the module docstring there
has the same text.

**Charge stock** of a player at the end of tick `t`:

```
stock(t) = sum of warehouse of the cities the player owns
         + sum of charges of the player's packets on roads
         + sum of charged of the player's groups (at nodes and on edges)
```

A charge is counted once: a charge that left a warehouse in a packet, or was taken by a unit
(recharge), is no longer in the warehouse. A captured city's warehouse is zeroed by the
simulation (`warehouse_lost`), so it drops out of the stock of the old owner at once. Enemy
charges are never counted.

`MatchRecorder` samples `stock(t)` after every tick `t = 1..ticks` into `MatchLog.stock` (a loop
over nodes, packets and groups: about 8 microseconds per tick on a loaded development machine, about
1% of a headless match). Per match and player:

| Value | Formula (integers, rounded down) |
|---|---|
| `stock_peak` | `max(stock(t))` over the samples; 0 without samples |
| `stock_mean_centi` | `sum(stock(t)) * 100 // n`, `n` the number of samples; in hundredths of a charge (`375` is 3.75 charges); `null` when `n = 0` |
| `charges_produced` | sum of `charges` of the player's `charges_produced` events: everything the economy made, the spill that does not fit into the capital included |
| `charges_burned` | sum of `charges` of the player's `charges_overflow` events: charges that found no room in a warehouse (the spill of the capital, or the end of a packet's path) |
| `burned_permille` | `charges_burned * 1000 // charges_produced`, per mille; `null` when nothing was produced |

Only `charges_overflow` is burning. Charges that disappear in other ways (`packet_lost` on a road
that stopped being internal, `warehouse_lost` on a capture, starvation, use in a fight) are not
counted as burned, and the start stock of the map is never produced, so it never burns. The
burned share is therefore between 0 and 1000 per mille.

The tournament report (`gow-bots report`, section "Charge stock and burned share") aggregates the rows per bot and
per map: mean of `stock_mean_centi` and of `stock_peak`, the highest peak, and the **burned share
of the group** = total `charges_burned` / total `charges_produced` over its matches (not the mean
of per-match shares, so a match with little production does not count as much as one with a lot).
`gow-bots analyze` prints the same fields for a real match.

## Отчёт

```bash
uv run gow-bots report docs/balance/latest.jsonl            # пишет latest.md и latest-*.png рядом
uv run gow-bots report run.jsonl --out-dir /tmp/rep --name run
```

Отчёт (`gow_bots.report`, matplotlib только здесь) строит по файлу турнира:
проверки компетентности ботов из BOT-05, матрицу пар с 95% интервалами Уилсона, преимущество
стороны (зеркальные матчи), метрики по ботам (доля запланированных атак, успех осад, захваты в
последние 3 минуты), разнообразие стратегий (доминирующая стратегия, циклы «камень-ножницы-бумага»),
число уникальных исходов и разбивку по картам. Выход зависит только от строк файла.

Закоммичен прогон BAL-01 (#39): `latest.jsonl` (3 карты, 5 стратегических ботов без `idle` и
`random_legal`, 100 сидов, 7500 матчей, `mvp-0`) и построенные по нему `latest.md`, `latest-*.png`.
Вердикт по критериям гейта и гипотезы для итераций BAL-02 (#40): [log.md](log.md).

## Бюджет

AGENTS.md, раздел 12: 1000 матчей на 8 ядрах эталонной машины не дольше 20 минут. Матч
`mvp-0` с ботами из BOT-01 занимает около 1.3 секунды одного ядра; замер полного турнира: `docs/perf.md`.
