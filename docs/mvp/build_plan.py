"""Validate issues.yaml and render MVP_PLAN.md, MVP_ISSUES.md, issues.json."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta
from collections import defaultdict
from pathlib import Path

import yaml

HERE = Path(__file__).parent
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)

data = yaml.safe_load((HERE / "issues.yaml").read_text(encoding="utf-8"))
meta = data["meta"]
milestones = {m["id"]: m for m in data["milestones"]}
ms_order = [m["id"] for m in data["milestones"]]
issues = data["issues"]
by_id = {i["id"]: i for i in issues}
SIZE_DAYS = meta["size_days"]
BASE = datetime(2026, 1, 1)
PRIO_RANK = {"P0": 0, "P1": 1, "P2": 2}

errors: list[str] = []
warnings: list[str] = []


def prio(i: dict) -> str:
    return next(l for l in i["labels"] if l in PRIO_RANK)


# ── structural validation ──────────────────────────────────────────
seen: set[str] = set()
for i in issues:
    iid = i["id"]
    if iid in seen:
        errors.append(f"duplicate id {iid}")
    seen.add(iid)
    for field in ("title", "milestone", "labels", "size", "track", "depends", "acceptance"):
        if field not in i:
            errors.append(f"{iid}: missing {field}")
    if i.get("milestone") not in milestones:
        errors.append(f"{iid}: unknown milestone {i.get('milestone')}")
    if i.get("size") not in SIZE_DAYS:
        errors.append(f"{iid}: bad size {i.get('size')}")
    if i.get("track") not in meta["tracks"]:
        errors.append(f"{iid}: bad track {i.get('track')}")
    prios = [l for l in i.get("labels", []) if l in PRIO_RANK]
    if len(prios) != 1:
        errors.append(f"{iid}: needs exactly one priority label")
    if not any(l.startswith("area:") for l in i.get("labels", [])):
        errors.append(f"{iid}: needs area label")
    if not any(l.startswith("type:") for l in i.get("labels", [])):
        errors.append(f"{iid}: needs type label")
    if "type:decision" in i.get("labels", []) and i["id"].startswith("DEC") and "default" not in i:
        errors.append(f"{iid}: decision without default")
    if not i.get("acceptance"):
        errors.append(f"{iid}: empty acceptance")
    if "type:decision" not in i.get("labels", []) and not i.get("tasks"):
        errors.append(f"{iid}: no tasks")
    for ref in i.get("depends", []) + i.get("related", []):
        if ref not in by_id:
            errors.append(f"{iid}: unknown ref {ref}")
        if ref == iid:
            errors.append(f"{iid}: self reference")

# ── cycle check + topo order ──────────────────────────────────────
order: list[str] = []
state: dict[str, int] = {}


def visit(n: str, stack: list[str]) -> None:
    if state.get(n) == 2:
        return
    if state.get(n) == 1:
        errors.append("cycle: " + " -> ".join(stack + [n]))
        return
    state[n] = 1
    for d in by_id[n]["depends"]:
        if d in by_id:
            visit(d, stack + [n])
    state[n] = 2
    order.append(n)


for i in issues:
    visit(i["id"], [])

# ── semantic warnings ──────────────────────────────────────────────
for i in issues:
    for d in i["depends"]:
        if d not in by_id:
            continue
        dep = by_id[d]
        if ms_order.index(dep["milestone"]) > ms_order.index(i["milestone"]):
            errors.append(f"{i['id']} ({i['milestone']}) depends on later {d} ({dep['milestone']})")
        if PRIO_RANK[prio(dep)] > PRIO_RANK[prio(i)]:
            errors.append(f"{i['id']} ({prio(i)}) depends on lower-priority {d} ({prio(dep)})")
    if i["size"] == "L":
        warnings.append(f"{i['id']}: size L — consider splitting")

if errors:
    print("ERRORS:")
    for e in errors:
        print("  -", e)
    sys.exit(1)

# ── scheduling (ideal person-days, 2 devs: A and B; 'any' goes to whoever is free) ──
dur = {i["id"]: SIZE_DAYS[i["size"]] for i in issues}
# critical path (longest path by duration) ignoring resources
ef: dict[str, float] = {}
pred: dict[str, str | None] = {}
for n in order:
    deps = by_id[n]["depends"]
    if deps:
        best = max(deps, key=lambda d: ef[d])
        ef[n] = ef[best] + dur[n]
        pred[n] = best
    else:
        ef[n] = dur[n]
        pred[n] = None
end = max(ef, key=lambda n: ef[n])
crit: list[str] = []
cur: str | None = end
while cur:
    crit.append(cur)
    cur = pred[cur]
crit.reverse()

# resource-constrained list scheduling
free = {"A": 0.0, "B": 0.0}
finish: dict[str, float] = {}
start: dict[str, float] = {}
assigned: dict[str, str] = {}
remaining = set(by_id)
# priority: milestone order, then P-rank, then topo order
topo_index = {n: k for k, n in enumerate(order)}
succ: dict[str, list[str]] = defaultdict(list)
for i in issues:
    for d in i["depends"]:
        succ[d].append(i["id"])
tail: dict[str, float] = {}
for n in reversed(order):
    tail[n] = dur[n] + max([tail[x] for x in succ[n]] + [0.0])
while remaining:
    ready = [n for n in remaining if all(d in finish for d in by_id[n]["depends"])]
    best = None
    for n in ready:
        earliest = max([finish[d] for d in by_id[n]["depends"]] + [0.0])
        tr = by_id[n]["track"]
        for dev in (["A", "B"] if tr == "any" else [tr]):
            s0 = max(free[dev], earliest)
            key = (s0, -tail[n], ms_order.index(by_id[n]["milestone"]), topo_index[n], dev)
            if best is None or key < best[0]:
                best = (key, n, dev, s0)
    _, n, dev, s0 = best
    start[n] = s0
    finish[n] = s0 + dur[n]
    free[dev] = finish[n]
    assigned[n] = dev
    remaining.remove(n)

total_days = sum(dur.values())
makespan = max(finish.values())
p0_days = sum(dur[i["id"]] for i in issues if prio(i) == "P0")

# ── helpers for rendering ─────────────────────────────────────────
PRIO_TEXT = {"P0": "P0 — обязательно для MVP", "P1": "P1 — желательно в MVP", "P2": "P2 — можно отложить"}


def md_list(items: list[str], checkbox: bool = False) -> str:
    pre = "- [ ] " if checkbox else "- "
    return "\n".join(pre + x for x in items)


def issue_body(i: dict, numbers: dict[str, int] | None = None) -> str:
    def ref(x: str) -> str:
        if numbers and x in numbers:
            return f"{x} (#{numbers[x]})"
        return x

    m = milestones[i["milestone"]]
    lines = [
        f"**Веха:** {m['title']} · **Приоритет:** {prio(i)} · **Размер:** {i['size']} ({meta['sizes'][i['size']]}) · **Трек:** {i['track']}",
    ]
    if i["depends"]:
        lines.append("**Зависит от:** " + ", ".join(ref(d) for d in i["depends"]))
    if i.get("related"):
        lines.append("**Связано:** " + ", ".join(ref(d) for d in i["related"]))
    lines.append("")
    if i.get("context"):
        lines += ["### Контекст", i["context"].strip(), ""]
    if i.get("default"):
        lines += ["### Решение по умолчанию", i["default"].strip(), ""]
    if i.get("alternatives"):
        lines += ["### Альтернативы", md_list(i["alternatives"]), ""]
    if i.get("tasks"):
        lines += ["### Задачи", md_list(i["tasks"], checkbox=True), ""]
    if i.get("notes"):
        lines += ["### Значения и примечания", i["notes"].strip(), ""]
    lines += ["### Критерии приёмки", md_list(i["acceptance"], checkbox=True), ""]
    if i.get("out_of_scope"):
        lines += ["### Вне рамок", md_list(i["out_of_scope"]), ""]
    if "type:decision" in i["labels"] and i["id"].startswith("DEC"):
        lines += [
            "### Как закрыть",
            "Значение по умолчанию уже есть, поэтому решение занимает не больше пары часов: подтвердить его "
            "или выбрать альтернативу и записать в `docs/design/mechanics.md` со статусом [принято]. "
            "Блокирует SIM-01 (DEC-05 — SRV-04, DEC-06 — RAT-02). Дальше числа меняются только через рулсет и BAL-02.",
            "",
        ]
    lines += ["---", "Definition of Done: см. `AGENTS.md` → «Definition of Done»."]
    return "\n".join(lines)


def title(i: dict) -> str:
    return f"[{i['id']}] {i['title']}"


# ── MVP_ISSUES.md ─────────────────────────────────────────────────
parts = [f"# {meta['title']}: issues", "",
         "> Сгенерировано из `issues.yaml`. Каждый блок — готовое тело GitHub issue; "
         "заголовок issue — строка `### [ID] …`.", ""]
for mid in ms_order:
    m = milestones[mid]
    parts += [f"## {m['title']}", "", f"*{m['goal']}*", ""]
    for i in [x for x in issues if x["milestone"] == mid]:
        labels = " ".join(f"`{l}`" for l in i["labels"] + [f"size:{i['size']}"])
        parts += [f"### {title(i)}", "", f"Метки: {labels}", "", issue_body(i), ""]
(OUT / "MVP_ISSUES.md").write_text("\n".join(parts), encoding="utf-8")

# ── MVP_PLAN.md ───────────────────────────────────────────────────
ms_stats = defaultdict(lambda: {"n": 0, "days": 0.0, "p0": 0})
for i in issues:
    s = ms_stats[i["milestone"]]
    s["n"] += 1
    s["days"] += dur[i["id"]]
    s["p0"] += prio(i) == "P0"

track_days = defaultdict(float)
for n, dev in assigned.items():
    track_days[dev] += dur[n]

plan: list[str] = []
plan += [f"# {meta['title']}", ""]
plan += ["## Что такое MVP", "", meta["mvp_definition"], ""]
plan += [
    "## Что не входит в MVP",
    "",
    md_list([
        "Строительство новых рёбер игроками (mechanics.md §8) — после MVP.",
        "Режимы доставки «пакеты / прокачка», трофеи со складов, обзор от размера группы.",
        "Запасные модели правил (вогнутая экономика, порог VP, бонус за финальное удержание) — реализуются, только если их потребует BAL-02.",
        "Процедурная генерация карт (только ручные карты и скрипт отзеркаливания), украинская локализация.",
        "FFA и командные режимы; только 1v1.",
        "Полноценные аккаунты и OAuth — только гостевая идентичность с возможностью «апгрейда» позже.",
        "Steam, мобильные устройства, чат, живые зрители, турниры, монетизация.",
        "Редактор карт с интерфейсом — только CLI-инструменты.",
    ]),
    "",
]
plan += [
    "## Главные принципы плана",
    "",
    md_list([
        "**Сначала механика, потом пиксели и метаигра.** Баланс-гейт BAL-02 проверяет глубину механики на ботах, внутренний плейтест PT-01 — на людях. Полировка клиента (CLI-12, CLI-13) зависит от BAL-02, вся метаигра (M5) — от PT-01.",
        "**Правила доопределены до уровня тестов.** Бой задан таблицей разобранных примеров (DEC-07); тесты SIM-09 — это ровно эта таблица.",
        "**Открытые вопросы закрываются в начале и быстро.** У каждого DEC-issue уже есть значение по умолчанию; подтверждение занимает пару часов и нужно до SIM-01. Дальше числа меняются только правкой рулсета.",
        "**Числа — данные.** Все параметры правил живут в `rulesets/*.toml`; балансировка — это правка файла и перезапуск турнира.",
        "**Два параллельных трека.** Трек A (Python) ведёт симуляцию, ботов и сервер; трек B (TypeScript и инструменты) — карты, клиент и инфраструктуру. Клиент начинается на данных карты до готовности протокола (CLI-03).",
        "**Каждый issue ≤ 5 дней и имеет проверяемые критерии приёмки.**",
    ]),
    "",
]
plan += ["## Вехи", "", "| Веха | Цель | Issues | P0 | Оценка, чел.-дней |", "|---|---|---|---|---|"]
for mid in ms_order:
    m = milestones[mid]
    s = ms_stats[mid]
    plan.append(f"| **{m['title']}** | {m['goal']} | {s['n']} | {s['p0']} | {s['days']:g} |")
plan.append(f"| **Итого** | | {len(issues)} | {sum(1 for i in issues if prio(i)=='P0')} | {total_days:g} |")
plan.append("")
plan += ["### Критерии выхода из вех", ""]
for mid in ms_order:
    m = milestones[mid]
    plan += [f"**{m['title']}**", "", md_list(m["exit"]), ""]

plan += [
    "## Оценка сроков",
    "",
    f"- Всего: **{total_days:g} идеальных человеко-дней** ({len(issues)} issues), из них P0 — {p0_days:g}.",
    f"- При двух разработчиках, работающих параллельно по трекам, расчётная длительность — **≈ {makespan:.0f} рабочих дней** "
    f"(трек A — {track_days['A']:g} дн., трек B — {track_days['B']:g} дн.).",
    "- Это «идеальные» дни полной занятости. Для работы по вечерам и выходным умножайте на 2–3; на итерации баланса (BAL-02) и плейтест (PT-01) заложите запас.",
    f"- Закрытый плейтест (REL-01) заканчивается на **≈ {finish['REL-01']:.0f}-й день**; после него в расчёте остаются только P1/P2-задачи, от которых релиз не зависит.",
    f"- Критический путь по зависимостям без учёта людей — {ef[end]:g} дней:",
    "",
    "  " + " → ".join(crit),
    "",
]

# mermaid gantt from schedule
plan += ["## Расчётный график", "", "Раскладка по двум трекам (день 0 — старт). "
         "Разработчик A — Python-трек, B — TypeScript и инструменты; issues с треком `any` отданы тому, кто свободен раньше.", "",
         "```mermaid", "gantt", "  title План MVP (идеальные дни от старта)", "  dateFormat YYYY-MM-DD HH:mm", "  axisFormat %j"]
for dev in ("A", "B"):
    plan.append(f"  section Разработчик {dev}")
    for n in sorted([n for n in assigned if assigned[n] == dev], key=lambda n: start[n]):
        t0 = BASE + timedelta(hours=start[n] * 24)
        plan.append(f"  {n} : {n.lower().replace('-', '')}, {t0:%Y-%m-%d %H:%M}, {int(dur[n] * 24)}h")
plan += ["```", "", "*Ось — номер идеального рабочего дня (001 — первый день). Календарные даты условные.*", ""]

plan += [
    "## Риски и как их снижаем",
    "",
    "| Риск | Признак | Что делаем |",
    "|---|---|---|",
    "| Механика окажется плоской | BAL-02 не проходит за таймбокс или PT-01 даёт «no-go» | Остановить M5; обсудить отложенные механики (новые рёбра, обзор от размера, запасные модели правил) |",
    "| Код даёт преимущество одной стороне | Преимущество стороны в отчёте BOT-05 | Двухфазное движение, симметричные бои (DEC-07), тест зеркальности в SIM-05 |",
    "| Python медленный для турнира или сервера | SIM-14 не укладывается в бюджет шага | Профилирование; упрощение маршрутизации снабжения; кэш ёмкости; в крайнем случае — горячие функции на Cython/mypyc |",
    "| Кривая обучения TypeScript у разработчика B | CLI-issues растягиваются вдвое | CLI-03 (карта из JSON) делать параллельно с сетевым слоем; держать клиент «тупым»; парное ревью |",
    "| Мало игроков для матчмейкинга | Очередь пустует | Бот-соперник (SRV-06), инвайты и лобби как основной путь; очередь — дополнительный |",
    "| Разрастание объёма из открытых вопросов | Новые механики просятся в MVP | Всё новое — флагом в рулсете и только после BAL-02 |",
    "| Утечки тумана войны | QA-04 или игроки находят скрытое в WebSocket | Единая функция `project()`, property-тесты SIM-14 и SIM-17, аудит QA-04 |",
    "",
]

plan += ["## Список issues", ""]
for mid in ms_order:
    m = milestones[mid]
    plan += [f"### {m['title']}", "", "| ID | Задача | Приоритет | Размер | Трек | Зависит от |", "|---|---|---|---|---|---|"]
    for i in [x for x in issues if x["milestone"] == mid]:
        deps = ", ".join(i["depends"]) or "—"
        plan.append(f"| {i['id']} | {i['title']} | {prio(i)} | {i['size']} | {i['track']} | {deps} |")
    plan.append("")

plan += [
    "## Как завести issues в GitHub",
    "",
    "Issues уже заведены в `DastinovDS/Skill-Based-Front`; соответствие ID → номер issue лежит в `docs/mvp/issue_map.json`. Повторный запуск нужен только после правки плана.",
    "",
    "1. Установить и авторизовать GitHub CLI: `gh auth login`.",
    "2. Проверить план без изменений: `python docs/mvp/import_github_issues.py --repo DastinovDS/Skill-Based-Front` (по умолчанию dry-run).",
    "3. Создать метки, вехи и issues: `python docs/mvp/import_github_issues.py --repo DastinovDS/Skill-Based-Front --apply`.",
    "4. Скрипт идемпотентен: уже созданные issues (по префиксу `[ID]` в заголовке) пропускаются; во втором проходе ссылки `SIM-03` в телах дополняются реальными номерами `#NN`. Соответствие сохраняется в `docs/mvp/issue_map.json`.",
    "5. Ветки — `feature/<номер>-<slug>`, коммиты — `<type>(<scope>): <сообщение> (#<номер>)` (см. AGENTS.md).",
    "",
]
(OUT / "MVP_PLAN.md").write_text("\n".join(plan), encoding="utf-8")

# ── issues.json (for importer) ────────────────────────────────────
LABEL_COLORS = {
    "area:": "1d76db", "type:": "5319e7", "P0": "b60205", "P1": "fbca04", "P2": "c5def5", "size:": "0e8a16",
}


def color(label: str) -> str:
    for k, v in LABEL_COLORS.items():
        if label.startswith(k):
            return v
    return "ededed"


all_labels = sorted({l for i in issues for l in i["labels"]} | {f"size:{s}" for s in SIZE_DAYS})
export = {
    "milestones": [{"id": m["id"], "title": m["title"], "description": m["goal"]} for m in data["milestones"]],
    "labels": [{"name": l, "color": color(l)} for l in all_labels],
    "issues": [
        {
            "id": i["id"],
            "title": title(i),
            "milestone": milestones[i["milestone"]]["title"],
            "labels": i["labels"] + [f"size:{i['size']}"],
            "depends": i["depends"],
            "related": i.get("related", []),
            "raw": i,
        }
        for i in (by_id[n] for n in order)  # topological order
    ],
}
(OUT / "issues.json").write_text(json.dumps(export, ensure_ascii=False, indent=2), encoding="utf-8")

# body template needs the renderer; store pre-rendered bodies without numbers too
for e in export["issues"]:
    e["body"] = issue_body(e["raw"])
    del e["raw"]
(OUT / "issues.json").write_text(json.dumps(export, ensure_ascii=False, indent=2), encoding="utf-8")

print(f"OK: {len(issues)} issues, {total_days:g} person-days, makespan ≈ {makespan:.1f} days")
print(f"tracks: A={track_days['A']:g}, B={track_days['B']:g}")
for dev in ("A","B"):
    seq=sorted([n for n in assigned if assigned[n]==dev], key=lambda n:start[n])
    t=0.0; gaps=[]
    for n in seq:
        if start[n]>t+1e-9: gaps.append((round(t,2),round(start[n],2),n))
        t=finish[n]
    print(dev, "idle gaps:", gaps)
print("critical path:", " -> ".join(crit), f"({ef[end]:g} d)")
for w in warnings:
    print("WARN", w)
