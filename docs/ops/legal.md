# Правовой минимум (LEG-01, #87)

Это не юридическая консультация. Тексты на `/impressum` и `/privacy` (ru и en) собраны по фактическому
поведению кода и содержат заглушки. **Перед публикацией сайта их должен проверить юрист**, а владелец
обязан подставить настоящие данные оператора.

## Что сделано в коде

- Страницы `/impressum` и `/privacy`: `apps/client/src/legal/LegalPage.svelte`, тексты по языкам в
  `apps/client/src/i18n/legal/{ru,en}.ts` (Caddy отдаёт `index.html` на любой неизвестный путь).
- Ссылки в подвале на каждом экране (в том числе на приветственном и в матче): `LegalFooter.svelte`,
  монтируется в `main.ts`. Ссылки открываются в новой вкладке, чтобы не прервать матч.
- Пока в тексте осталась заглушка вида `<OPERATOR_NAME>`, страница показывает пометку «Черновик».
  Когда все заглушки заменены, пометка исчезает сама.
- Логи контейнеров: `compose.yaml`, драйвер `json-file`, ротация по размеру (`max-size: 10m`,
  `max-file: 3`), записи удаляются вместе с контейнером при деплое.

## Какие данные обрабатывает приложение (проверено по коду)

| Данные | Где | Срок |
|---|---|---|
| ник, `created_at`, SHA-256 токена (`players`, `identity.py`) | БД `/data/gow.db` | до удаления по запросу |
| хэш пароля, если игрок его задал: `scrypt$n$r$p$соль$хэш` (`players.password_hash`, `passwords.py`, #374); сам пароль не хранится, не пишется в журнал и не возвращается в ошибках 422; восстановления пароля нет | БД | до удаления по запросу или сброса (`gow-admin reset-password`) |
| токен и ник | `localStorage["sbf.guest"]` в браузере (`guestStore.ts`) | пока игрок не очистит |
| язык интерфейса | `localStorage["sbf.locale"]` (`locale.ts`) | то же |
| рейтинг, матчи, стороны (`ratings`, `matches`, `match_players`) | БД | до удаления по запросу |
| реплеи (`*.jsonl.gz`, `*.frames.json.gz`) | `/data/replays`, ника не содержат | бессрочно |
| статистика игры из журнала команд матча (стойка, частота команд, действия снабжения, доля запланированных приказов, траты CP): `gow-bots analyze` и `gow-bots stats` считают её офлайн из реплея; никуда не сохраняется; привязка к игроку только по стороне матча (`match_players`), для баланса и разбора партий (#375) | вывод команды, в БД и на сервере не хранится | как у реплеев |
| IP при создании гостя | память процесса, `SlidingWindowLimiter` (окно `GOW_GUEST_RATE_WINDOW_S`, 1 ч) | до окна или перезапуска |
| IP и `nick_key` попыток входа по паролю (`abuse.Limits.login_ip`, `login_nick`) | память процесса (окна `GOW_LOGIN_IP_RATE_WINDOW_S`, `GOW_LOGIN_NICK_RATE_WINDOW_S`, 10 мин) | до окна или перезапуска |
| журнал сервера (`app.py`, `logs.py`) | stderr контейнера: метод, путь без query, статус, время, request id; без IP и токенов | ротация |
| журнал Caddy | access log не настроен (`deploy/Caddyfile` без `log`); служебный журнал может содержать IP в ошибках | ротация |

Cookie, аналитики, сторонних сервисов и сбора ошибок нет; CSP `default-src 'self'` запрещает внешние запросы.

## Удаление гостя по запросу

Физически удалять строку `players` нельзя (внешний ключ из `match_players`, а `player_id` не может быть NULL),
поэтому гостя обезличивают: меняют ник и хэш токена, удаляют хэш пароля и рейтинг. Матчи остаются без связи с человеком.
Перед правкой сделайте бэкап: `deploy/backup.sh before-delete`.

```bash
docker compose exec app python - <<'PY'
import os, sqlite3, sys
from gow_server.nicks import skeleton
nick = "<NICK>"  # ник из запроса
db = sqlite3.connect("/data/gow.db")
row = db.execute("SELECT id FROM players WHERE nick_key = ?", (skeleton(nick),)).fetchone()
if row is None:
    sys.exit("no such nick")
with db:
    db.execute(
        "UPDATE players SET nick = ?, nick_key = ?, token_hash = ?, password_hash = NULL"
        " WHERE id = ?",
        (f"deleted-{row[0]}", f"deleted-{row[0]}", os.urandom(32), row[0]),
    )
    db.execute("DELETE FROM ratings WHERE player_id = ?", (row[0],))
print("anonymized player", row[0])
PY
```

Подтверждение владения ником (у аккаунта нет e-mail): по согласованию, например матч в оговорённое время.

## MANUAL: что остаётся человеку

- Подставить в `apps/client/src/i18n/legal/{ru,en}.ts` данные оператора: `<OPERATOR_NAME>`, `<STREET_AND_NUMBER>`,
  `<POSTAL_CODE_AND_CITY>`, `<COUNTRY>`, `<EMAIL>`, `<PHONE>`, `<VAT_ID_OR_REMOVE_THIS_SECTION>`,
  `<HOSTING_PROVIDER>`, `<HOSTING_LOCATION>`, `<CONFIRM_DPA>`, `<SUPERVISORY_AUTHORITY>`, `<DATE>`.
- Подтвердить `<LOG_RETENTION_DAYS>` по реальному объёму логов на VPS (ротация идёт по размеру, а не по времени)
  или ввести ограничение по времени (например, `journald` или ежедневный `docker compose restart`/пересоздание).
- Юридическая проверка текстов (Impressum по § 5 DDG, политика по GDPR, оценка хранения в `localStorage` без
  баннера согласия); при необходимости добавить немецкий текст: добавить `de` в `LOCALES`, словарь и
  `i18n/legal/de.ts`.
- Заключить договор об обработке данных с хостинг-провайдером (AVV/DPA).
- MANUAL (#375): юрист проверяет абзац о статистике игры в разделе «Матчи, рейтинг и реплеи» политики
  (ru и en) и строку таблицы выше: правовое основание (баланс и разбор партий, ст. 6(1)(f) GDPR),
  срок хранения «как у реплеев», нужно ли отдельное упоминание в «Ваших правах».
