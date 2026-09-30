# Бюджеты производительности и эталонная машина

Бюджеты перечислены в `AGENTS.md`, раздел 12. Здесь: на какой машине они заданы, как их меряют и
что считается регрессией.

## Эталонная машина

| Параметр | Значение |
|---|---|
| Процессор | Apple M4, 10 ядер |
| Память | 16 ГБ |
| ОС | macOS 15.7 |
| Python | CPython 3.12 (`uv run`, без отладчика и профайлера) |

Раннеры GitHub Actions (`ubuntu-latest`, CI `py`) медленнее эталона; запас на это даёт правило
регрессии ниже.

## Как мерить

Бенчмарки: `packages/sim/tests/test_benchmarks.py` (`pytest-benchmark`). Они входят в обычный
`uv run pytest` и в CI.

```sh
uv run pytest packages/sim/tests/test_benchmarks.py            # таблица времени и проверка бюджетов
uv run pytest --benchmark-disable                             # один прогон без замеров и без проверок
```

| Бенчмарк | Что меряется | Бюджет |
|---|---|---|
| `test_bench_step` | `Match.step` без проекций, карта 40 узлов (`grid40` из `conftest.py`) с 40 группами, оба игрока под `ExpandBot`; контроллеры и проекции в нетаймированном `setup` | в среднем ≤ 0,3 мс, p99 ≤ 1 мс |
| `test_bench_supply` | система `supply` на состоянии после 300 тиков той же партии, с пакетами в пути | ≤ 0,1 мс |
| `test_bench_project` | одна `project()` на том же состоянии | ≤ 0,3 мс |
| `test_bench_full_headless_match` | `run_headless` двух `ExpandBot` до конца партии на `pautina` (самая большая карта MVP по рёбрам) | ≤ 8 с |

## Регрессия

Бенчмарк падает, если результат больше бюджета больше чем на 50% (`REGRESSION = 1.5` в
`test_benchmarks.py`): так шум и более медленный раннер CI не ломают сборку, а настоящая регрессия
ломает.

Для сравнения двух версий кода на одной машине есть штатное сравнение `pytest-benchmark`:

```sh
uv run pytest packages/sim/tests/test_benchmarks.py --benchmark-autosave             # на старой версии
uv run pytest packages/sim/tests/test_benchmarks.py --benchmark-compare --benchmark-compare-fail=mean:50%
```

Сохранённые результаты лежат в `.benchmarks/` и не коммитятся (зависят от машины).

## Замеры на эталоне (SIM-15)

| Что | Среднее |
|---|---|
| шаг, 40 узлов, 40 групп | ≈ 0,15 мс (p99 ≈ 0,25 мс) |
| `supply` | ≈ 0,05 мс |
| `project()` | ≈ 0,11 мс |
| полная партия headless (7200 тиков) | ≈ 1,4 с |
