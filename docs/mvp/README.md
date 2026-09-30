# Набор для работы с планом MVP

- `issues.json` + `import_github_issues.py` — импорт issues, меток и вех в GitHub:
  `python import_github_issues.py --repo DastinovDS/Skill-Based-Front` (dry run), затем с `--apply`.
  Issues уже заведены; соответствие ID → номер issue: `issue_map.json`.
  Нужен авторизованный GitHub CLI (`gh auth login`).
- `issues.yaml` — единственный источник плана. После правок:
  `pip install pyyaml && python build_plan.py` — проверяет граф зависимостей (циклы, приоритеты,
  порядок вех), пересчитывает оценку и график и заново пишет `out/MVP_PLAN.md`, `out/MVP_ISSUES.md`, `out/issues.json`.
